export default function DefaultLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex flex-col min-h-screen md-app overflow-hidden">
      <main className="container mx-auto max-w-6xl px-4 sm:px-6 flex-grow pt-6 md-enter">
        {children}
      </main>
    </div>
  );
}
