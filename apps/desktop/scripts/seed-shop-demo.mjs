// Explicit demo seeding only. Run through authenticated desktop or web API adapters.
export async function seedShopDemo(auth, management, sales) {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const login = async (username, password) => {
    const result = await auth.login(username, password);
    check(result.ok, `Cannot sign in as ${username}: ${result.message || ''}`);
  };
  const base = { id: '', name: '', phone: '', passport: '', identity: '', pricePaisa: 0, quantity: 0 };
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const operation = (shop, kind, index) => `de000000-0000-4000-8000-${String(shop * 1000 + kind * 100 + index).padStart(12, '0')}`;
  const summary = [];
  await login('admin', 'PosAdmin123!');
  for (const [index, name, username, password] of [
    [1, 'Main Shop', 'demo', 'PosDemo123!'],
    [2, 'North Shop', 'cashier.north', 'PosCashier123!'],
    [3, 'South Shop', 'cashier.south', 'PosCashier123!'],
  ]) {
    let shop = (await management.list('shop', '')).find(row => index === 1 ? row.id === 'main-shop' : row.name === name);
    if (!shop) { await management.save({ ...base, kind: 'shop', name }); shop = (await management.list('shop', name)).find(row => row.name === name); }
    check(shop, `Missing ${name}`);
    if (index === 1 && shop.name !== name) { await management.save({ ...shop, name }); shop.name = name; }
    const cashier = (await management.list('cashier', '')).find(row => row.username === username);
    if (!cashier) await management.save({ ...base, kind: 'cashier', name: `${name} cashier`, phone: `0300000010${index}`, username, password, shopId: shop.id });
    else if (cashier.shopId !== shop.id) await management.save({ ...cashier, phone: cashier.phone || `0300000010${index}`, shopId: shop.id });
    const creditorName = `Demo creditor - ${name}`;
    let creditor = (await management.list('creditor', creditorName)).find(row => row.name === creditorName);
    if (!creditor) { await management.save({ ...base, kind: 'creditor', name: creditorName, phone: `0300000020${index}` }); creditor = (await management.list('creditor', creditorName)).find(row => row.name === creditorName); }
    const itemName = `Demo filter meal - ${name}`;
    let item = (await management.list('menu', itemName)).find(row => row.name === itemName);
    if (!item) { await management.save({ ...base, kind: 'menu', name: itemName, pricePaisa: index * 1000, quantity: 100 }); item = (await management.list('menu', itemName)).find(row => row.name === itemName); }
    const existingSales = await sales.history({ start: '2000-01-01', end: '2099-12-31', type: 'all', shopId: shop.id });
    const existingExpenses = await sales.expenses('2000-01-01', '2099-12-31', shop.id);
    const existingRepayments = await sales.repayments('2000-01-01', '2099-12-31', shop.id);
    await login(username, password);
    for (let n = 1; n <= 10; n++) {
      if (!existingSales.some(row => row.id === operation(index, 1, n))) {
        const credit = n > 6;
        const result = await sales.save({ operationId: operation(index, 1, n), customerType: credit ? 'creditor' : 'walk-in', creditorId: credit ? creditor.id : null,
          lines: [{ itemId: item.id, quantity: 1, unitPrice: item.pricePaisa }], receivedMinor: credit ? item.pricePaisa / 2 : item.pricePaisa });
        check(result.ok, result.message);
      }
      if (!existingExpenses.some(row => row.id === operation(index, 2, n))) {
        const result = await sales.saveExpense({ operationId: operation(index, 2, n), date, category: n % 2 ? 'Supplies' : 'Utilities',
          description: `Demo filter expense ${n} - ${name}`, paidVia: n % 2 ? 'cash' : 'online', amountMinor: index * 100 + n * 10 });
        check(result.ok, result.message);
      }
    }
    await login('admin', 'PosAdmin123!');
    if (!existingRepayments.some(row => row.id === operation(index, 3, 1))) {
      const result = await sales.recoverCredit({ operationId: operation(index, 3, 1), creditorId: creditor.id, date, amountMinor: index * 500, shopId: shop.id });
      check(result.ok, result.message);
    }
    const shopSales = await sales.history({ start: '2000-01-01', end: '2099-12-31', type: 'all', shopId: shop.id });
    const shopExpenses = await sales.expenses('2000-01-01', '2099-12-31', shop.id);
    const seededSales = shopSales.filter(row => Array.from({ length: 10 }, (_, n) => operation(index, 1, n + 1)).includes(row.id));
    const seededExpenses = shopExpenses.filter(row => Array.from({ length: 10 }, (_, n) => operation(index, 2, n + 1)).includes(row.id));
    check(seededSales.length === 10 && seededExpenses.length === 10, `Incomplete records for ${name}`);
    const account = await sales.creditorAccount(creditor.id);
    summary.push({ shop: name, username, sales: seededSales.length, expenses: seededExpenses.length,
      salesQar: seededSales.reduce((sum, row) => sum + row.total, 0) / 100,
      expensesQar: seededExpenses.reduce((sum, row) => sum + row.amountMinor, 0) / 100,
      creditor: creditorName, outstandingQar: account.outstanding / 100 });
  }
  return summary;
}
