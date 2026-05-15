import { FaFacebookF, FaInstagram, FaLinkedinIn, FaXTwitter } from "react-icons/fa6";

interface AppFooterProps {
  loginMode?: boolean;
}

export function AppFooter({ loginMode = false }: AppFooterProps) {
  return (
    <footer className={`brand-footer${loginMode ? " login-page-footer" : ""}`}>
      <div className="brand-footer-left">Dev by <strong>IA Infinity</strong></div>
      <div className="brand-footer-center">© 2026 Hilê - Fábrica de suplementos alimentares</div>
      <div className="brand-footer-right brand-footer-socials">
        <a href="https://www.facebook.com" target="_blank" rel="noreferrer" aria-label="Facebook">
          <FaFacebookF />
        </a>
        <a href="https://x.com" target="_blank" rel="noreferrer" aria-label="Twitter">
          <FaXTwitter />
        </a>
        <a href="https://www.instagram.com/hileterceirizacao/" target="_blank" rel="noreferrer" aria-label="Instagram">
          <FaInstagram />
        </a>
        <a href="https://www.linkedin.com" target="_blank" rel="noreferrer" aria-label="LinkedIn">
          <FaLinkedinIn />
        </a>
      </div>
    </footer>
  );
}
