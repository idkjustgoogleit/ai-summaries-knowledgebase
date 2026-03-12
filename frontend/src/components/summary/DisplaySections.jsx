import React from 'react';

/**
 * DisplaySections - Renders collapsible content sections
 *
 * @param {Object} summary - The summary object containing all content
 * @param {Object} expandedSections - Object tracking which sections are expanded
 * @param {Function} onToggleSection - Callback to toggle section expansion
 * @param {Function} renderContent - Function to render content based on type
 */
function DisplaySections({ summary, expandedSections, onToggleSection, renderContent }) {
  const CollapsibleSection = ({ title, icon, expanded, onToggle, children, className }) => {
    return (
      <div className={`bg-dark-card rounded-lg border border-gray-700 ${className}`}>
        <button
          onClick={onToggle}
          className="w-full flex items-center justify-between p-4 hover:bg-dark-bg transition-colors rounded-lg"
        >
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            {icon && <span className="text-accent">{icon}</span>}
            {title}
          </h2>
          <svg
            className={`w-5 h-5 text-text-secondary transition-transform ${
              expanded ? 'rotate-180' : ''
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {expanded && <div className="px-2 md:px-4 pb-2 md:pb-4">{children}</div>}
      </div>
    );
  };

  const getTldr = () => {
    if (!summary) return null;
    return summary.tldr || summary.other2 || null;
  };

  return (
    <>
      {/* TL;DR Section - only render if TL;DR content exists */}
      {getTldr() && (
        <CollapsibleSection
          title="TL;DR"
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          }
          expanded={expandedSections.tldr}
          onToggle={() => onToggleSection('tldr')}
          className="mb-4"
        >
          <div className="text-white whitespace-pre-wrap leading-relaxed">
            {getTldr()}
          </div>
        </CollapsibleSection>
      )}

      {/* Description Section */}
      <CollapsibleSection
        title="Description"
        icon={
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        }
        expanded={expandedSections.description}
        onToggle={() => onToggleSection('description')}
        className="mb-4"
      >
        <div className="text-white whitespace-pre-wrap leading-relaxed">
          {summary.description || <span className="text-text-secondary">No description available</span>}
        </div>
      </CollapsibleSection>

      {/* Summary Section */}
      <CollapsibleSection
        title="Summary"
        icon={
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
          </svg>
        }
        expanded={expandedSections.summary}
        onToggle={() => onToggleSection('summary')}
        className="mb-4"
      >
        <div className="prose prose-invert max-w-none">
          {renderContent(summary.summary || summary.summary_text || summary.content)}
        </div>
      </CollapsibleSection>

      {/* Key Insights Section */}
      <CollapsibleSection
        title="Key Insights"
        icon={
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        }
        expanded={expandedSections.keyInsights}
        onToggle={() => onToggleSection('keyInsights')}
        className="mb-4"
      >
        {renderContent(summary.key_insights)}
      </CollapsibleSection>

      {/* Actionable Takeaways Section */}
      <CollapsibleSection
        title="Actionable Takeaways"
        icon={
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
        }
        expanded={expandedSections.actionableTakeaways}
        onToggle={() => onToggleSection('actionableTakeaways')}
        className="mb-4"
      >
        {renderContent(summary.actionable_takeaways)}
      </CollapsibleSection>
    </>
  );
}

export default DisplaySections;
