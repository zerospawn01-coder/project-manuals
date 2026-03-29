const stages = [
    'Request enters deterministic gate.',
    '2FA and arm state are verified.',
    'World patch is applied and logged.',
    'Rollback telemetry remains visible.'
];

const TransactionFlowDemo = () => {
    return (
        <main
            style={{
                minHeight: '100vh',
                display: 'grid',
                placeItems: 'center',
                padding: '2rem',
                background:
                    'radial-gradient(circle at top, rgba(68,136,255,0.28), transparent 40%), #0d1117',
                color: '#fff'
            }}
        >
            <section
                className="glass-panel"
                style={{ maxWidth: '720px', width: '100%', padding: '2rem' }}
            >
                <p style={{ color: '#00ff88', letterSpacing: '0.2em', fontSize: '0.8rem' }}>
                    TRANSACTION GATE DEMO
                </p>
                <h1 style={{ marginTop: 0 }}>Deterministic execution path</h1>
                <p style={{ color: '#8b949e', lineHeight: 1.6 }}>
                    This demo keeps the UI usable even when the production views are not mounted.
                    It shows the intended operator flow and preserves a clean fallback for review.
                </p>
                <div style={{ display: 'grid', gap: '0.75rem', marginTop: '1.5rem' }}>
                    {stages.map((stage, index) => (
                        <div
                            key={stage}
                            style={{
                                padding: '1rem',
                                border: '1px solid rgba(0, 255, 136, 0.2)',
                                borderRadius: '12px',
                                background: 'rgba(255,255,255,0.03)'
                            }}
                        >
                            {index + 1}. {stage}
                        </div>
                    ))}
                </div>
            </section>
        </main>
    );
};

export default TransactionFlowDemo;
