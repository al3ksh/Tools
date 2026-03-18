function EmptyState({ icon: Icon, title, description }) {
  return (
    <div className="empty-state">
      {Icon && <div className="empty-icon"><Icon size={64} style={{ margin: '0 auto' }} /></div>}
      <div className="empty-title">{title}</div>
      {description && <p>{description}</p>}
    </div>
  );
}

export default EmptyState;
