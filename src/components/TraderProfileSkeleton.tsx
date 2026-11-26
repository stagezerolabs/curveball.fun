export function TraderProfileSkeleton() {
  return (
    <main
      className="trader-profile-page profile-shell"
      aria-busy="true"
      aria-label="Loading profile"
    >
      <div className="profile-layout">
        <div className="profile-sidebar">
          <div className="profile-loading-rail">
            <span className="skeleton" />
            <span className="skeleton" />
            <span className="skeleton" />
            <span className="skeleton" />
          </div>
        </div>
        <div className="profile-stage profile-overview">
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
          </div>
        </div>
      </div>
    </main>
  );
}
