import { useStore } from '../state/worldStore';

const fallbackSteps = [
    'Validate blast radius before rollout.',
    'Confirm rollback plan and operator assignment.',
    'Record audit evidence before state mutation.'
];

const RunbookPanel = () => {
    const latestRunbook = useStore((state) =>
        state.auditLog.find((entry) => entry.runbook)?.runbook
    );

    const steps = latestRunbook?.steps?.length ? latestRunbook.steps : fallbackSteps;
    const title = latestRunbook?.title ?? 'RUNBOOK_STANDBY';
    const severity = latestRunbook?.severity ?? 'info';

    return (
        <aside className="side-panel glass-panel" aria-label="Runbook panel">
            <div className="panel-header">
                <span>{title}</span>
                <span>{severity.toUpperCase()}</span>
            </div>
            {steps.map((step, index) => (
                <div
                    key={`${title}-${index}`}
                    className={`runbook-step ${index === 0 ? 'active' : ''}`}
                >
                    {step}
                </div>
            ))}
        </aside>
    );
};

export default RunbookPanel;
