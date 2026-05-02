import type { PaginationInfo } from "../lib/api-client";

export function PaginationControls({
  pagination,
  label,
  itemLabel,
  onPageChange
}: {
  pagination: PaginationInfo;
  label: string;
  itemLabel: string;
  onPageChange: (page: number) => void;
}) {
  if (pagination.totalPages <= 1) return null;
  const start = (pagination.page - 1) * pagination.pageSize + 1;
  const end = Math.min(pagination.total, pagination.page * pagination.pageSize);

  return (
    <nav className="pagination-bar" aria-label={label}>
      <span className="pagination-summary">
        {pagination.total.toLocaleString()}개 {itemLabel} 중 {start.toLocaleString()}-{end.toLocaleString()}
      </span>
      <div className="pagination-controls">
        <button
          className="button secondary small page-button"
          type="button"
          onClick={() => onPageChange(pagination.page - 1)}
          disabled={!pagination.hasPrev}
        >
          이전
        </button>
        {pageItems(pagination.page, pagination.totalPages).map((item, index) =>
          typeof item === "number" ? (
            <button
              className={`button secondary small page-button ${item === pagination.page ? "active" : ""}`}
              type="button"
              key={item}
              onClick={() => onPageChange(item)}
              aria-current={item === pagination.page ? "page" : undefined}
            >
              {item}
            </button>
          ) : (
            <span className="pagination-ellipsis" key={`${item}-${index}`}>...</span>
          )
        )}
        <button
          className="button secondary small page-button"
          type="button"
          onClick={() => onPageChange(pagination.page + 1)}
          disabled={!pagination.hasNext}
        >
          다음
        </button>
      </div>
    </nav>
  );
}

function pageItems(page: number, totalPages: number): Array<number | "ellipsis"> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);

  const pages = new Set([1, totalPages, page - 1, page, page + 1]);
  if (page <= 4) {
    [2, 3, 4, 5].forEach((value) => pages.add(value));
  }
  if (page >= totalPages - 3) {
    [totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1].forEach((value) => pages.add(value));
  }

  const sorted = [...pages].filter((value) => value >= 1 && value <= totalPages).sort((left, right) => left - right);
  const items: Array<number | "ellipsis"> = [];
  for (const value of sorted) {
    const previous = items.at(-1);
    if (typeof previous === "number" && value - previous > 1) items.push("ellipsis");
    items.push(value);
  }
  return items;
}
