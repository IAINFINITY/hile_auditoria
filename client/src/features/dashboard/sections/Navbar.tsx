import type { MouseEvent } from "react";

interface NavbarProps {
  navClass: (section: string) => string;
  onNavigate: (section: string) => void;
}

export function Navbar({ navClass, onNavigate }: NavbarProps) {
  function handleClick(section: string, event: MouseEvent<HTMLElement>) {
    event.preventDefault();
    onNavigate(section);
  }

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <button type="button" className="navbar-brand" onClick={(event) => handleClick("inicio", event)}>
          <span className="navbar-brand-mark">
            <img src="/hile-1-photoaidcom-cropped.png" alt="Hilê" className="navbar-brand-logo" />
          </span>
          <span className="navbar-brand-text">Hilê Auditoria</span>
        </button>
        <div className="navbar-links" id="navLinks">
          <button type="button" className={navClass("inicio")} onClick={(event) => handleClick("inicio", event)}>Métricas</button>
          <button type="button" className={navClass("gaps")} onClick={(event) => handleClick("gaps", event)}>Gaps</button>
          <button type="button" className={navClass("insights")} onClick={(event) => handleClick("insights", event)}>Insights</button>
          <button type="button" className={navClass("movimentacao")} onClick={(event) => handleClick("movimentacao", event)}>Movimentação</button>
          <button type="button" className={navClass("relatorio")} onClick={(event) => handleClick("relatorio", event)}>Relatório</button>
        </div>
      </div>
    </nav>
  );
}
