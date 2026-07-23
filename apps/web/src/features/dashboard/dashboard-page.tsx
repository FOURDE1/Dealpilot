import { useSession } from '../../shared/auth/client.js';

/** Placeholder dashboard — the first feature slice (F-01) fills this shell. */
export function DashboardPage() {
  const { data: session } = useSession();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Bonjour{session ? `, ${session.user.name || session.user.email}` : ''}</h1>
      <div className="rounded-lg border border-border bg-card p-4 text-card-foreground">
        <h2 className="text-[15px] font-semibold">Bienvenue sur 1Dealer</h2>
        <p className="text-sm text-muted-foreground">
          La coquille de l'application est en place. Les modules (prospects, pipeline, livraisons)
          arriveront par tranches fonctionnelles.
        </p>
      </div>
    </div>
  );
}
