import Image from "next/image";

export function SplashScreen() {
  return (
    <div className="splash-screen">
      <div className="splash-logo">
        <Image src="/logo_hile1.png" alt="Hilê" width={280} height={96} priority />
      </div>
      <div className="splash-copy">
        <h1>
          PAINEL <span>DE AUDITORIA</span>
        </h1>
        <p>Inicializando painel operacional...</p>
      </div>
    </div>
  );
}
