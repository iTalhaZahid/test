import { Router } from 'express';
import type { Pool } from 'pg';
import { transaction } from '../postgres/database.js';
import { PgWebStore } from '../postgres/web-store.js';
import { WebSync } from '../postgres/web-sync.js';
import { ApiError } from '../models/validation.js';

export function webSyncRoutes(pool: Pool) {
  const router=Router();
  router.use(async (request,response,next)=>{
    if (!['/auth/login','/auth/password','/sync/pull','/sync/push'].includes(request.path)) {next();return;}
    try {
      const result=await transaction(pool,'pos_web',async db=>{
        const web=new PgWebStore(db,process.env.POS_WEB_DEMO==='1'),sync=new WebSync(db,web);
        const token=request.get('authorization')?.replace(/^Bearer /,'')||'';
        if (request.path==='/auth/login'&&request.method==='POST') return sync.login(request.body);
        if (request.path==='/sync/pull'&&request.method==='GET') return sync.pull(await sync.device(token),request.query.after??0,request.query.invoiceLast??0,request.query.invoiceRemaining??0);
        if (request.path==='/sync/push'&&request.method==='POST') {
          const device=await sync.device(request.get('x-pos-device-token')||'');
          return sync.push(device,await sync.actor(token),request.body?.changes);
        }
        if (request.path==='/auth/password'&&request.method==='POST') {
          const user=await sync.actor(token);
          await web.auth.changePassword(user.id,request.body?.current,request.body?.next,async()=>!!await web.user(token));
          return {ok:true};
        }
        throw new ApiError(405,'Unsupported sync request.');
      });
      response.json(result);
    } catch(error) {
      const validation=error instanceof Error&&!('code' in error);
      const status=error instanceof ApiError?error.status:validation?409:503;
      response.status(status).json({error:validation?error.message:'Website database is unavailable. Offline entries are retained.'});
    }
  });
  return router;
}
