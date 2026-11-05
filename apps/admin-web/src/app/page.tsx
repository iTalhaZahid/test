export default function Home() {
  return <main className="mx-auto max-w-4xl px-6 py-20">
    <p className="text-xs font-bold tracking-widest">POS / ADMINISTRATION</p>
    <h1 className="my-8 text-5xl leading-tight font-semibold tracking-tight sm:text-7xl">Your business,<br />in view.</h1>
    <p className="max-w-xl leading-relaxed">Online management and reporting for your business.</p>
    <section aria-labelledby="status" className="mt-12 space-y-4 border-t border-stone-300 pt-6"><h2 id="status" className="text-xl font-semibold">Foundation ready</h2>
      <p className="max-w-xl leading-relaxed">Account access, menu management, and reports will arrive in later milestones.</p>
      <p className="max-w-xl leading-relaxed">New sales, repayments, and expenses belong on your Windows terminal.</p>
    </section>
  </main>;
}
