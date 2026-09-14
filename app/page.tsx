export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">
        Scan the QR code at your barbershop
      </h1>
      <p className="max-w-sm text-muted-foreground">
        Join the queue from your phone and we&apos;ll tell you when it&apos;s almost
        your turn.
      </p>
    </main>
  );
}
