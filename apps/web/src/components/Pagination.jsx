import { ChevronLeft, ChevronRight } from 'lucide-react';

function Pagination({ currentPage, totalItems, itemsPerPage, onPageChange }) {
    const totalPages = Math.ceil(totalItems / itemsPerPage);

    if (totalPages <= 1) return null;

    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderTop: '1px solid var(--border)', backgroundColor: 'var(--bg-card)', borderBottomLeftRadius: '8px', borderBottomRightRadius: '8px' }}>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, totalItems)} of {totalItems} entries
            </div>
            <div style={{ display: 'flex', gap: '5px' }}>
                <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={currentPage === 1}
                    onClick={() => onPageChange(currentPage - 1)}
                    style={{ padding: '4px 8px', display: 'flex', alignItems: 'center' }}
                >
                    <ChevronLeft size={16} />
                </button>
                <div style={{ display: 'flex', alignItems: 'center', padding: '0 8px', fontSize: '13px', fontWeight: 500 }}>
                    Page {currentPage} of {totalPages}
                </div>
                <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={currentPage === totalPages}
                    onClick={() => onPageChange(currentPage + 1)}
                    style={{ padding: '4px 8px', display: 'flex', alignItems: 'center' }}
                >
                    <ChevronRight size={16} />
                </button>
            </div>
        </div>
    );
}

export default Pagination;
