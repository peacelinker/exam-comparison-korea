export interface SnapshotMetric {
  label: string;
  value: string;
}

export interface SnapshotCard {
  title: string;
  caption: string;
  primaryLabel: string;
  primaryValue: string;
  metrics: SnapshotMetric[];
}

interface ReportSnapshotProps {
  title: string;
  eyebrow: string;
  dateLabel: string;
  cards: SnapshotCard[];
  totalCaption: string;
  totalMetrics: SnapshotMetric[];
  keyStats: SnapshotMetric[];
  totalFirst?: boolean;
}

function MetricGrid({
  metrics,
  compact = false,
}: {
  metrics: SnapshotMetric[];
  compact?: boolean;
}) {
  return (
    <div className={compact ? "snapshot-metrics compact" : "snapshot-metrics"}>
      {metrics.map((metric) => (
        <div key={`${metric.label}-${metric.value}`}>
          <span>{metric.label}</span>
          <strong>{metric.value}</strong>
        </div>
      ))}
    </div>
  );
}

function ReportSnapshot({
  title,
  eyebrow,
  dateLabel,
  cards,
  totalCaption,
  totalMetrics,
  keyStats,
  totalFirst = false,
}: ReportSnapshotProps) {
  const totalCard = (
    <article className="snapshot-total-card">
      <div className="snapshot-card-title">
        <span aria-hidden="true" />
        <h4>전체</h4>
      </div>
      <p className="snapshot-caption">{totalCaption}</p>
      <MetricGrid metrics={totalMetrics} />
    </article>
  );

  return (
    <section className="report-snapshot" aria-label={title}>
      <header className="snapshot-header">
        <div>
          <h3>{title}</h3>
          <p>{eyebrow}</p>
        </div>
        <span className="snapshot-date">{dateLabel}</span>
      </header>

      {totalFirst && totalCard}

      <div className="snapshot-card-grid">
        {cards.map((card) => (
          <article className="snapshot-card" key={card.title}>
            <div className="snapshot-card-title">
              <span aria-hidden="true" />
              <h4>{card.title}</h4>
            </div>
            <p className="snapshot-caption">{card.caption}</p>
            <div className="snapshot-primary">
              <span>{card.primaryLabel}</span>
              <strong>{card.primaryValue}</strong>
            </div>
            <MetricGrid metrics={card.metrics} compact />
          </article>
        ))}
      </div>

      {!totalFirst && totalCard}

      <section className="snapshot-key-panel" aria-label="핵심 현황">
        <h4>
          <span aria-hidden="true">📌</span>
          핵심 현황
        </h4>
        <dl>
          {keyStats.map((stat) => (
            <div key={`${stat.label}-${stat.value}`}>
              <dt>{stat.label}</dt>
              <dd>{stat.value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </section>
  );
}

export default ReportSnapshot;
