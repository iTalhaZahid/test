import type { AuthStore } from './auth-store';
import type { LocalUser, LoginResult } from './auth-contract';
import type { SyncStatus } from './sync-contract';
import { SyncStore } from './sync-store';

class HttpError extends Error {
  constructor(public status: number,message: string) { super(message); }
}
class NetworkError extends Error {}
export class SyncEngine {
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private stopped=false;
  private loginBusy=false;
  private offlineConfirmed=false;
  private abort=new AbortController();
  private failures=0;
  private statusValue: SyncStatus={state:'offline',pending:0};
  readonly endpoint: string;
  private readonly prefix: string;
  constructor(private store: SyncStore, private auth: AuthStore, private fetcher: typeof fetch = fetch) {
    const url=new URL(store.backend);
    if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))))throw new Error('POS_API_URL must be an HTTPS origin (HTTP is allowed on localhost only).');
    this.endpoint=url.origin;
    this.prefix=store.website?'/api/v1/web':'/api/v1';
  }
  status(): SyncStatus { const pending=this.store.pending();return {...this.statusValue,state:this.statusValue.state==='online'&&pending?'syncing':this.statusValue.state,pending}; }
  private async request(route: string,body?: unknown,token?: string) {
    let response: Response;
    try { response=await this.fetcher(`${this.endpoint}${route}`,{
      method:body===undefined?'GET':'POST',
      headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:`Bearer ${token}`} : {}),...(this.store.website&&route===`${this.prefix}/sync/push`?{'X-POS-Device-Token':this.store.credentials().deviceToken||''}:{})},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),
      signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(this.store.website?60000:8000)]),
      redirect:'error',
    }); } catch { this.offlineConfirmed=true;throw new NetworkError('The POS server is unreachable. Local changes are retained.'); }
    this.offlineConfirmed=false;
    if(this.stopped)throw new Error('Sync stopped.');
    let result: Record<string,unknown>;
    try { result=await response.json() as Record<string,unknown>; }
    catch { throw new HttpError(502,'Invalid response from the POS server.'); }
    if(!response.ok)throw new HttpError(response.status,typeof result.error==='string'?result.error:'Server request failed.');
    return result;
  }
  async login(username: unknown,password: unknown): Promise<LoginResult> {
    if(typeof username!=='string'||typeof password!=='string'||!username.trim()||username.length>64||!password||password.length>128)return {ok:false,message:'Enter a valid username and password.'};
    if(this.loginBusy)return {ok:false,message:'A sign-in is already in progress.'};
    this.loginBusy=true;
    try {
      if(this.running)await this.running;
      if(this.offlineConfirmed&&this.store.canLoginOffline(username.trim()))return this.auth.login(username,password);
      const credentials=this.store.credentials();
      const result=await this.request(`${this.prefix}/auth/login`,{username,password,deviceId:credentials.deviceId,deviceToken:credentials.deviceToken});
      if(result.ok===false)throw new HttpError(401,typeof result.message==='string'?result.message:'Sign-in failed.');
      const user=result.user as LocalUser;
      if(!user||typeof user.id!=='string'||typeof user.username!=='string'||typeof user.displayName!=='string'||!['cashier','admin','superuser'].includes(user.role)||typeof user.shopId!=='string'||typeof result.deviceToken!=='string'||!/^[a-f\d]{64}$/.test(result.deviceToken)||typeof result.token!=='string'||typeof result.expiresAt!=='number'||result.expiresAt<=Date.now())throw new HttpError(502,'Invalid login response.');
      await this.auth.cacheOnlineUser(user,password);
      this.store.setCredentials({...credentials,deviceToken:result.deviceToken,token:result.token,expiresAt:result.expiresAt,...(this.store.website?{users:{...credentials.users,[user.id]:{token:result.token,expiresAt:result.expiresAt}}}:{})});
      this.store.db.exec('BEGIN IMMEDIATE; UPDATE sync_control SET applying=1 WHERE id=1');
      try { this.store.withRemoteUser(user);this.store.db.exec('UPDATE sync_control SET applying=0 WHERE id=1; COMMIT'); }
      catch(error) { this.store.db.exec('ROLLBACK'); throw error; }
      // Complete the initial catalog download before enabling offline sign-in.
      await this.pull();
      const localUser=this.auth.user(user.id);
      if(!localUser)return {ok:false,message:'This account has been disabled locally. Reconnect and sync before signing in.'};
      this.store.rememberLogin(user.username,result.expiresAt);
      this.statusValue={state:'syncing',pending:this.store.pending()};
      return {ok:true,user:localUser};
    } catch(error) {
      if(error instanceof HttpError&&error.status<500)return {ok:false,message:error.message};
      if(!(error instanceof NetworkError)&&!(error instanceof HttpError))return {ok:false,message:'Could not cache your account and menus safely. Retry online sign-in.'};
      this.statusValue={state:'offline',pending:this.store.pending()};
      if(!this.store.canLoginOffline(username.trim()))return {ok:false,message:'Internet and a reachable POS server are required for your first login on this device.'};
      return this.auth.login(username,password);
    } finally { this.loginBusy=false;void this.retry(); }
  }
  async changePassword(user: LocalUser,current: unknown,next: unknown) {
    if(typeof current!=='string'||typeof next!=='string'||next.length<8||next.length>128)throw new Error('Use a password of 8–128 characters.');
    const credentials=this.store.credentials();
    if(!credentials.token)throw new Error('Sign in online before changing your password.');
    await this.request(`${this.prefix}/auth/password`,{current,next},credentials.users?.[user.id]?.token??credentials.token);
    await this.auth.cacheOnlineUser(user,next);
    this.store.setCredentials({...credentials,token:undefined});
  }
  private async pull() {
    const credentials=this.store.credentials();
    if(!credentials.deviceToken)return;
    for(let page=0;page<1000;page++) {
      const invoices=this.store.invoiceStatus();
      const response=await this.request(`${this.prefix}/sync/pull?after=${this.store.cursor()}${this.store.website?`&invoiceLast=${invoices.last}&invoiceRemaining=${invoices.remaining}`:''}`,undefined,credentials.deviceToken);
      this.store.apply(response);
      if(!response.hasMore)return;
    }
    throw new Error('Catalog download is incomplete. Retry sync.');
  }
  start() { void this.retry(); }
  async retry() {
    if(this.stopped)return;
    if(this.running)return this.running;
    if(this.timer)clearTimeout(this.timer);
    this.running=this.cycle().finally(()=>{
      this.running=undefined;
      if(!this.stopped)this.timer=setTimeout(()=>void this.retry(),Math.min(60000,5000*2**Math.min(this.failures,4)));
    });
    return this.running;
  }
  private async cycle() {
    if(this.loginBusy)return;
    try {
      const health=await this.request('/health');
      if(health.status!=='ok')throw new Error('POS server unavailable.');
      const credentials=this.store.credentials();
      if(!credentials.deviceToken){this.statusValue={state:'auth-required',pending:this.store.pending(),message:'Sign in with a POS server account to pair this terminal and sync.'};return;}
      this.statusValue={state:'syncing',pending:this.store.pending()};
      for(let batch=0;batch<10;batch++) {
        const changes=this.store.batch();
        if(!changes.length)break;
        if(this.store.website) {
          const acknowledgements:unknown[]=[];
          for(const actorId of new Set(changes.map(change=>change.actorId))) {
            const account=actorId?credentials.users?.[actorId]:undefined;
            if(!account||account.expiresAt<=Date.now())throw new HttpError(401,'Sign in online with the account that recorded these entries. Unsynced entries are retained.');
            const response=await this.request(`${this.prefix}/sync/push`,{changes:changes.filter(change=>change.actorId===actorId)},account.token);
            if(!Array.isArray(response.acknowledgements))throw new Error('Invalid server acknowledgement.');
            acknowledgements.push(...response.acknowledgements);
          }
          this.store.acknowledge(changes,changes.map(change=>acknowledgements.find(value=>{const ack=value as {entity:string;key:string;revision:number};return ack.entity===change.entity&&ack.key===change.key&&ack.revision===change.revision;})));
        } else {
          const response=await this.request(`${this.prefix}/sync/push`,{changes},credentials.deviceToken);
          this.store.acknowledge(changes,response.acknowledgements);
        }
      }
      await this.pull();
      this.failures=0;
      const pending=this.store.pending();
      this.statusValue={state:pending?'syncing':'online',pending};
    } catch(error) {
      if(this.stopped)return;
      this.failures++;
      this.statusValue={state:error instanceof NetworkError?'offline':error instanceof HttpError&&(error.status===401||error.status===403)?'auth-required':'error',pending:this.store.pending(),message:error instanceof Error?error.message:'Sync unavailable.'};
    }
  }
  stop() { this.stopped=true;this.abort.abort();if(this.timer)clearTimeout(this.timer);return this.running; }
}
