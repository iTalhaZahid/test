/* eslint-disable @typescript-eslint/no-require-imports -- Electron main script uses CommonJS. */
const { app, safeStorage } = require('electron');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const console = require('node:console');
const { SalesStore, businessDate } = require('../dist/main/sales-store');
app.whenReady().then(() => {
  const directory = path.join(app.getPath('appData'), 'POS Terminal Development');
  const filename = path.join(directory, 'pos.sqlite');
  assert.ok(fs.existsSync(filename), 'Development database must already exist');
  assert.ok(safeStorage.isEncryptionAvailable(), 'Recovery encryption unavailable');
  const db = new DatabaseSync(filename);
  const backup = path.join(directory, `before-chart-demo-${Date.now()}.sqlite`);
  db.prepare('VACUUM INTO ?').run(backup);
  const actor = role => db.prepare('SELECT id,username,display_name AS displayName,role FROM local_users WHERE role=? LIMIT 1').get(role);
  const admin = actor('admin');
  const cashier = db.prepare("SELECT u.id,u.username,u.display_name AS displayName,u.role FROM local_users u JOIN development_records r ON r.id=u.id WHERE u.role='cashier' AND r.archived=0 AND r.shop_id<>'' AND r.manage_finance=1 LIMIT 1").get();
  assert.ok(admin && cashier, 'Registered admin and assigned cashier required');
  cashier.manageCreditsExpenses=true;
  const recovery = path.join(app.getPath('appData'), 'POS Development Recovery');
  fs.mkdirSync(recovery, { recursive:true });
  const sales = new SalesStore(filename, path.join(recovery,'pending.sqlite'), value=>safeStorage.encryptString(value));
  const creditor = db.prepare("SELECT id FROM development_records WHERE kind='creditor' AND archived=0 LIMIT 1").get();
  const items = sales.menu(cashier,'');
  assert.ok(creditor && items.length, 'Creditor and menu required');
  const RealDate = Date;
  const today = businessDate(new RealDate());
  try {
    for(let day=0;day<14;day++) {
      const d = new RealDate(`${today}T12:00:00+05:00`); d.setUTCDate(d.getUTCDate()-day);
      const date = businessDate(d);
      globalThis.Date = class extends RealDate { constructor(...args){super(...(args.length?args:[d.getTime()]));} static now(){return d.getTime();} };
      const item=items[day%items.length], quantity=2+day%4;
      const operationId=`ce000000-0000-4000-8000-${date.replaceAll('-','')}0001`;
      if(!db.prepare('SELECT id FROM sales WHERE id=?').get(operationId)) {
        const result=sales.save(cashier,{operationId,customerType:'creditor',creditorId:creditor.id,lines:[{itemId:item.id,quantity,unitPrice:item.priceMinor}],receivedMinor:0});
        assert.ok(result.ok,result.message);
      }
      const sale=JSON.parse(db.prepare('SELECT payload FROM sales WHERE id=?').get(operationId).payload);
      const recoveryId=operationId.slice(0,-1)+'2';
      if(!db.prepare('SELECT id FROM repayments WHERE id=?').get(recoveryId)) {
        const result=sales.recoverCredit(admin,{operationId:recoveryId,creditorId:creditor.id,date,shopId:sale.shopId,amountMinor:Math.max(1,Math.floor(sale.total/3))});
        assert.ok(result.ok,result.message);
      }
    }
    const count=db.prepare("SELECT COUNT(DISTINCT business_date) AS dates FROM sales WHERE id LIKE 'ce000000-%'").get().dates;
    assert.ok(count>=14);
    console.log(JSON.stringify({backup,distinctDemoDates:count}));
  } finally {globalThis.Date=RealDate;sales.close();db.close();}
  app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
