import React, { useState, useRef, useEffect } from 'react';
import { apiFetch } from '../../utils/api';

/**
 * NotesSection - Notes editor component with auto-save
 *
 * @param {string} summaryId - The ID of the summary
 * @param {string} summaryType - The type of summary ('custom' or default)
 * @param {string} initialNotes - Initial notes content
 * @param {boolean} isAuthenticated - Whether user is authenticated
 * @param {boolean} expanded - Whether the section is expanded
 * @param {Function} onToggle - Callback to toggle expansion
 */
function NotesSection({ summaryId, summaryType, initialNotes, isAuthenticated, expanded, onToggle }) {
  const [notes, setNotes] = useState(initialNotes || '');
  const [savingNotes, setSavingNotes] = useState(false);
  const notesTimeoutRef = useRef(null);

  // Update local state when initialNotes changes from parent
  useEffect(() => {
    setNotes(initialNotes || '');
  }, [initialNotes]);

  const handleNotesChange = (value) => {
    setNotes(value);

    // Debounced save
    if (notesTimeoutRef.current) {
      clearTimeout(notesTimeoutRef.current);
    }

    notesTimeoutRef.current = setTimeout(() => {
      saveNotes(value);
    }, 1000);
  };

  const saveNotes = async (value) => {
    if (!isAuthenticated) return;

    setSavingNotes(true);
    try {
      const endpoint = summaryType === 'custom'
        ? `/api/summariesCustom/${summaryId}`
        : `/api/summaries/${summaryId}`;

      await apiFetch(endpoint, {
        method: 'PUT',
        body: JSON.stringify({ notes: value })
      });
    } catch (err) {
      console.error('Failed to save notes:', err);
    } finally {
      setSavingNotes(false);
    }
  };

  if (!isAuthenticated) return null;

  return (
    <div className={`bg-dark-card rounded-lg border border-gray-700 mb-4`}>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:bg-dark-bg transition-colors rounded-lg"
      >
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <svg className="w-6 h-6 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          Notes
          {savingNotes && (
            <span className="text-xs text-text-secondary ml-2">Saving...</span>
          )}
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
      {expanded && (
        <div className="px-2 md:px-4 pb-2 md:pb-4">
          <textarea
            value={notes}
            onChange={(e) => handleNotesChange(e.target.value)}
            placeholder="Add your notes here..."
            className="w-full min-h-[150px] p-4 bg-dark-bg border border-gray-700 rounded-lg text-white placeholder-text-secondary focus:outline-none focus:ring-2 focus:ring-accent resize-y"
          />
        </div>
      )}
    </div>
  );
}

export default NotesSection;
