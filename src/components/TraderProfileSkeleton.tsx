export function TraderProfileSkeleton() {
  return (
    <main
      className="trader-profile-page wrap"
      aria-busy="true"
      aria-label="Loading profile"
    >
      <div className="profile-top">
        <div className="profile-hero">
          <span className="profile-hero-avatar skeleton" />
          <div className="profile-hero-copy">
            <span className="skeleton profile-loading-line wide" />
            <span className="skeleton profile-loading-line short" />
            <span className="skeleton profile-loading-line medium" />
          </div>
        </div>
        <div className="profile-summary profile-loading-summary">
          <span className="skeleton profile-loading-line short" />
          <span className="skeleton profile-loading-line wide" />
          <span className="skeleton profile-loading-line medium" />
          <div className="profile-loading-stats">
            <span className="skeleton" />
            <span className="skeleton" />
            <span className="skeleton" />
          </div>
        </div>
      </div>
      <div className="profile-loading-tabs">
        <span className="skeleton" />
        <span className="skeleton" />
        <span className="skeleton" />
      </div>
      <div className="profile-loading-rows">
        <span className="skeleton" />
        <span className="skeleton" />
        <span className="skeleton" />
      </div>
    </main>
  );
}
