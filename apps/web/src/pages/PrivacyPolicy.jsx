import { FileText } from 'lucide-react';

function PrivacyPolicy() {
    return (
        <>
            <div className="page-header">
                <div className="page-title">
                    <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <FileText size={24} /> Privacy Policy
                    </h2>
                    <div className="subtitle">How we handle your data</div>
                </div>
            </div>

            <div className="content">
                <div className="card">
                    <div className="card-body" style={{ lineHeight: '1.8', fontSize: '14px' }}>
                        <h3 style={{ marginBottom: '16px' }}>1. Data We Collect</h3>
                        <p style={{ marginBottom: '16px', color: 'var(--text-secondary)' }}>
                            This application uses <strong>session cookies</strong> to identify your browser session.
                            We store a randomly generated session ID in your browser's localStorage.
                            No personal information (name, email, IP address) is collected or stored.
                        </p>

                        <h3 style={{ marginBottom: '16px' }}>2. Cookies</h3>
                        <p style={{ marginBottom: '16px', color: 'var(--text-secondary)' }}>
                            We use a single functional cookie to remember your cookie consent preference.
                            The session ID stored in localStorage is used to associate your uploaded files,
                            downloads, and shortened links with your browser session.
                            No third-party tracking cookies are used.
                        </p>

                        <h3 style={{ marginBottom: '16px' }}>3. Files & Data Retention</h3>
                        <p style={{ marginBottom: '16px', color: 'var(--text-secondary)' }}>
                            Guest session files (downloads, conversions, drops) are automatically deleted after <strong>1 hour</strong>.
                            Admin files do not expire automatically.
                            All files are stored on the server and are not shared with any third parties.
                        </p>

                        <h3 style={{ marginBottom: '16px' }}>4. Third-Party Services</h3>
                        <p style={{ marginBottom: '16px', color: 'var(--text-secondary)' }}>
                            When using the Downloader tool, URLs you provide are processed through <strong>yt-dlp</strong> to
                            fetch media metadata and content. We do not log or store the URLs you submit beyond the
                            job processing lifecycle.
                        </p>

                        <h3 style={{ marginBottom: '16px' }}>5. Your Rights</h3>
                        <p style={{ color: 'var(--text-secondary)' }}>
                            Since we do not collect personal data, there is no personal information to access,
                            modify, or delete. Your session data is ephemeral and automatically purged.
                            You may clear your browser's localStorage at any time to reset your session.
                        </p>
                    </div>
                </div>
            </div>
        </>
    );
}

export default PrivacyPolicy;
