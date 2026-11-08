import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { AuthStore, DEMO_PASSWORD, DEMO_USERNAME, ADMIN_USERNAME, ADMIN_PASSWORD } from './auth-store';
import { ManagementStore } from './management-store';
import { allowsDemo } from './runtime-mode';
import { backendConfig } from './backend-config';
import { writeFileSync } from 'node:fs';

test('desktop backend configuration supports packaged and per-terminal URLs without database secrets', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'pos-config-'));
  const file = path.join(directory, 'pos-config.json');
  try {
    assert.equal(backendConfig(undefined, [file]), undefined);
    writeFileSync(file, JSON.stringify({ POS_API_URL: 'https://pos.example.com/' }));
    assert.equal(backendConfig(undefined, [file]), 'https://pos.example.com');
    assert.equal(backendConfig('http://127.0.0.1:4000', [file]), 'http://127.0.0.1:4000');
    for (const url of ['postgresql://user:secret@host/db', 'http://remote.example', 'https://host/api', 'https://user:secret@host']) {
      assert.throws(() => backendConfig(url, []));
    }
    writeFileSync(file, '{}');
    assert.throws(() => backendConfig(undefined, [file]), /requires POS_API_URL/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('only development and the explicitly named demo package enable demo access', () => {
  assert.equal(allowsDemo(false, '@pos/desktop'), true);
  assert.equal(allowsDemo(true, 'POS Terminal Demo'), true);
  assert.equal(allowsDemo(true, 'POS Terminal Standalone'), true);
  assert.equal(allowsDemo(true, 'POS Terminal'), false);
  assert.equal(allowsDemo(true, '@pos/desktop'), false);
});

// Tests isolate OS encryption; the running Electron app verifies safeStorage separately.
const protection = {
  encrypt: async (value: string) => Buffer.from(value),
  decrypt: async (value: Buffer) => value.toString(),
};

test('cashier creation, password replacement, archival and idempotent samples', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'pos-cashier-'));
  const file = path.join(directory, 'pos.sqlite');
  const auth = new AuthStore(file, protection, true);
  const management = new ManagementStore(file, true);
  try {
    await auth.initialize();
    const verifier = await auth.cashierVerifier('FirstPass123!');
    management.seed(verifier); management.seed(verifier);
    assert.equal(management.list('admin','cashier','').length, 3);
    management.save('admin', { id:'', kind:'cashier', name:'Test cashier', phone:'03001234567', passport:'', identity:'', pricePaisa:0, quantity:0, username:'test.cashier', shopId:'main-shop' }, verifier);
    const record = management.list('admin','cashier','Test cashier')[0];
    let login = await auth.login('test.cashier','FirstPass123!');
    assert.ok(login.ok); assert.equal(login.user.role,'cashier');
    management.save('admin', { ...record, name:'Updated cashier' });
    assert.ok((await auth.login('test.cashier','FirstPass123!')).ok);
    management.save('admin',record,await auth.cashierVerifier('SecondPass123!'));
    assert.equal((await auth.login('test.cashier','FirstPass123!')).ok,false);
    login = await auth.login('test.cashier','SecondPass123!');
    assert.ok(login.ok); assert.equal(login.user.role,'cashier');
    assert.throws(() => management.save('admin',{...record,id:'',username:'test.cashier'},verifier), /This username is already in use/);
    assert.throws(() => management.save('admin',{...record,id:'',username:'TEST.CASHIER'},verifier), /This username is already in use/);
    const caseVariant = await auth.login('  TeSt.CaShIeR  ','SecondPass123!');
    assert.ok(caseVariant.ok); assert.equal(caseVariant.user.id,record.id);
    assert.equal((await auth.login('TEST.CASHIER','secondpass123!')).ok,false);
    assert.equal(management.list('admin','cashier','').length,4);
    await assert.rejects(auth.changePassword(record.id,'incorrect','SelfPassword123!',() => true));
    await assert.rejects(auth.changePassword(record.id,'SecondPass123!','SelfPassword123!',() => false));
    assert.ok((await auth.login('test.cashier','SecondPass123!')).ok);
    await auth.changePassword(record.id,'SecondPass123!','SelfPassword123!',() => true);
    assert.equal((await auth.login('test.cashier','SecondPass123!')).ok,false);
    assert.ok((await auth.login('test.cashier','SelfPassword123!')).ok);
    management.remove('admin','cashier',record.id);
    assert.equal((await auth.login('test.cashier','SelfPassword123!')).ok,false);
    await assert.rejects(auth.cashierVerifier('short'));
  } finally { management.close(); auth.close(); rmSync(directory,{recursive:true,force:true}); }
});

test('local login persists, rejects invalid input and SQL injection, and excludes demo accounts in releases', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'pos-auth-'));
  const file = path.join(directory, 'pos.sqlite');
  let store = new AuthStore(file, protection, true);
  try {
    await store.initialize();
    await store.initialize();
    assert.equal((await store.login('', '')).ok, false);
    assert.equal((await store.login({}, [])).ok, false);
    assert.equal((await store.login('x'.repeat(65), DEMO_PASSWORD)).ok, false);
    assert.equal((await store.login("' OR 1=1 --", DEMO_PASSWORD)).ok, false);
    assert.equal((await store.login(DEMO_USERNAME, 'wrong')).ok, false);
    const result = await store.login(DEMO_USERNAME, DEMO_PASSWORD);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.user.role, 'cashier');
    const admin = await store.login(ADMIN_USERNAME, ADMIN_PASSWORD);
    assert.ok(admin.ok);
    assert.equal(admin.user.role, 'admin');
    const uppercaseAdmin = await store.login('ADMIN', ADMIN_PASSWORD);
    assert.ok(uppercaseAdmin.ok); assert.equal(uppercaseAdmin.user.id,admin.user.id);
    store.close();
    assert.equal(readFileSync(file).includes(Buffer.from(DEMO_PASSWORD)), false);
    store = new AuthStore(file, protection, true);
    assert.equal((await store.login(DEMO_USERNAME, DEMO_PASSWORD)).ok, true);
    store.close();
    store = new AuthStore(file, protection, false);
    assert.equal((await store.login(ADMIN_USERNAME, ADMIN_PASSWORD)).ok, false);
    assert.equal((await store.login(DEMO_USERNAME, DEMO_PASSWORD)).ok, false);
    store.close();
    store = new AuthStore(file, protection, true);
    for (let index = 0; index < 5; index++) await store.login(DEMO_USERNAME, 'wrong');
    store.close();
    store = new AuthStore(file, protection, true);
    const blocked = await store.login(DEMO_USERNAME, DEMO_PASSWORD);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.match(blocked.message, /30 seconds/);
    store.close();
    store = new AuthStore(path.join(directory, 'release.sqlite'), protection, false);
    await store.initialize();
    assert.equal((await store.login(DEMO_USERNAME, DEMO_PASSWORD)).ok, false);
    store.close();
    store = new AuthStore(file, protection, false);
    assert.equal((await store.login(DEMO_USERNAME, DEMO_PASSWORD)).ok, false);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
