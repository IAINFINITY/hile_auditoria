interface PaginationControlsProps {
  total: number;
  safePage: number;
  pages: number;
  onPrev: () => void;
  onNext: () => void;
}

export function PaginationControls({
  total,
  safePage,
  pages,
  onPrev,
  onNext,
}: PaginationControlsProps) {
  return (
    <div className="pagination-row">
      <span>
        {total} registros • Página {safePage} de {pages}
      </span>
      <button type="button" onClick={onPrev} disabled={safePage <= 1}>
        {"<"}
      </button>
      <button type="button" onClick={onNext} disabled={safePage >= pages}>
        {">"}
      </button>
    </div>
  );
}
