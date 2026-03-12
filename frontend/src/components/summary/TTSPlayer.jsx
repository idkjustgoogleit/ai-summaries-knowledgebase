import React, { useEffect, useState, useRef } from 'react';
import LoadingSpinner from '../Shared/LoadingSpinner';

/**
 * TTSPlayer - Text-to-Speech player component
 *
 * @param {Object} summary - The summary object containing content to be read
 * @param {Function} onStateChange - Callback function to notify parent of state changes
 */
function TTSPlayer({ summary, onStateChange }) {
  const [ttsState, setTtsState] = useState({
    isPlaying: false,
    isPaused: false,
    currentChunk: 0,
    totalChunks: 0
  });

  const [voicesLoaded, setVoicesLoaded] = useState(false);
  const [ttsRetryCount, setTtsRetryCount] = useState(0);

  const ttsChunkIndexRef = useRef(0);
  const ttsUtterancesRef = useRef([]);
  const ttsVoiceLoadTimeoutRef = useRef(null);

  // Load TTS voices with retry strategy
  useEffect(() => {
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      console.log('TTS Voices loaded:', voices.length, voices);

      if (voices.length > 0) {
        setVoicesLoaded(true);
        setTtsRetryCount(0);
        if (ttsVoiceLoadTimeoutRef.current) {
          clearTimeout(ttsVoiceLoadTimeoutRef.current);
        }
      }
    };

    // Initial load
    loadVoices();

    // Set up voices changed listener
    window.speechSynthesis.onvoiceschanged = loadVoices;

    // Retry strategy: if no voices after 500ms, try again
    const timeout1 = setTimeout(() => {
      const voices = window.speechSynthesis.getVoices();
      console.log('TTS Retry 1 (500ms):', voices.length, 'voices');
      if (voices.length > 0) {
        setVoicesLoaded(true);
      }
    }, 500);
    ttsVoiceLoadTimeoutRef.current = timeout1;

    // Retry strategy: if still no voices after 1000ms, try again
    const timeout2 = setTimeout(() => {
      const voices = window.speechSynthesis.getVoices();
      console.log('TTS Retry 2 (1000ms):', voices.length, 'voices');
      if (voices.length > 0) {
        setVoicesLoaded(true);
      }
    }, 1000);

    // Cleanup timeouts on unmount
    return () => {
      clearTimeout(timeout1);
      clearTimeout(timeout2);
      if (ttsVoiceLoadTimeoutRef.current) {
        clearTimeout(ttsVoiceLoadTimeoutRef.current);
      }
    };
  }, []);

  // Notify parent of state changes
  useEffect(() => {
    if (onStateChange) {
      onStateChange(ttsState);
    }
  }, [ttsState, onStateChange]);

  const getTTSContent = () => {
    if (!summary) return '';

    const sections = [];

    if (summary.tldr) sections.push(summary.tldr);
    if (summary.description) sections.push('Description: ' + summary.description);
    if (summary.summary || summary.summary_text || summary.content) {
      sections.push('Summary: ' + (summary.summary || summary.summary_text || summary.content));
    }
    if (summary.key_insights) {
      sections.push('Key Insights: ' + formatContentForTTS(summary.key_insights));
    }
    if (summary.actionable_takeaways) {
      sections.push('Actionable Takeaways: ' + formatContentForTTS(summary.actionable_takeaways));
    }

    return sections.join('\n\n');
  };

  const formatContentForTTS = (content) => {
    // Handle arrays, objects, or strings
    if (Array.isArray(content)) {
      return content.map((item, index) => `${index + 1}. ${item}`).join('\n');
    }
    if (typeof content === 'object' && content !== null) {
      return Object.entries(content).map(([key, value]) => `${key}: ${value}`).join('\n');
    }
    return String(content);
  };

  const chunkText = (text, chunkSize = 5000) => {
    const chunks = [];
    let currentChunk = '';

    // Split by paragraphs first
    const paragraphs = text.split('\n\n');

    for (const paragraph of paragraphs) {
      if (currentChunk.length + paragraph.length > chunkSize) {
        if (currentChunk) chunks.push(currentChunk);
        currentChunk = paragraph;
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
      }
    }

    if (currentChunk) chunks.push(currentChunk);
    return chunks;
  };

  const handleTTSPlay = () => {
    if (ttsState.isPlaying && ttsState.isPaused) {
      handleTTSResume();
      return;
    }

    console.log('TTS Play called, isPlaying:', ttsState.isPlaying, 'voicesLoaded:', voicesLoaded);

    // Force reload voices to ensure they're available
    const voices = window.speechSynthesis.getVoices();
    console.log('Available TTS voices:', voices.length);

    // If no voices loaded, trigger a retry
    if (voices.length === 0) {
      console.log('TTS: No voices available, triggering reload...');
      setTtsRetryCount(prev => prev + 1);
      // Try to trigger voice loading by creating a dummy utterance
      const dummyUtterance = new SpeechSynthesisUtterance('');
      window.speechSynthesis.speak(dummyUtterance);
      window.speechSynthesis.cancel();

      // Wait a bit and check again
      setTimeout(() => {
        const retryVoices = window.speechSynthesis.getVoices();
        console.log('TTS: Retry voices count:', retryVoices.length);
        if (retryVoices.length === 0) {
          alert('Text-to-Speech voices are not available in your browser. Please try a different browser or refresh the page.');
          return;
        }
        // Retry TTS play with voices loaded
        if (retryVoices.length > 0) {
          setVoicesLoaded(true);
          continueWithTTS(retryVoices);
        }
      }, 500);
      return;
    }

    continueWithTTS(voices);

    function continueWithTTS(availableVoices) {
      const textContent = getTTSContent();
      if (!textContent) {
        console.error('TTS: No text content available');
        return;
      }

      const chunks = chunkText(textContent);
      console.log('TTS: Text chunked into', chunks.length, 'chunks');

      setTtsState({ isPlaying: true, isPaused: false, currentChunk: 0, totalChunks: chunks.length });

      // Reset chunk index using ref
      ttsChunkIndexRef.current = 0;
      ttsUtterancesRef.current = [];

      const speakNext = () => {
        const currentIndex = ttsChunkIndexRef.current;
        console.log('TTS: Speaking chunk', currentIndex + 1, 'of', chunks.length);

        if (currentIndex >= chunks.length) {
          console.log('TTS: All chunks completed');
          setTtsState({ isPlaying: false, isPaused: false, currentChunk: 0, totalChunks: 0 });
          ttsUtterancesRef.current = [];
          return;
        }

        const utterance = new SpeechSynthesisUtterance(chunks[currentIndex]);

        // Set voice to Microsoft Mark if available
        const currentVoices = window.speechSynthesis.getVoices();
        const microsoftMarkVoice = currentVoices.find(voice =>
          voice.name.includes('Microsoft Mark') || voice.name.includes('Mark')
        );
        if (microsoftMarkVoice) {
          utterance.voice = microsoftMarkVoice;
          console.log('TTS: Using voice:', microsoftMarkVoice.name);
        } else {
          console.log('TTS: Microsoft Mark voice not found, using default');
        }

        utterance.onend = () => {
          console.log('TTS: Chunk', currentIndex + 1, 'completed');
          ttsChunkIndexRef.current++;
          setTtsState(prev => ({ ...prev, currentChunk: ttsChunkIndexRef.current }));
          speakNext();
        };

        utterance.onerror = (error) => {
          console.error('TTS utterance error:', error, 'at chunk', currentIndex);
          ttsChunkIndexRef.current++;
          setTtsState(prev => ({ ...prev, currentChunk: ttsChunkIndexRef.current }));
          speakNext();
        };

        // Store utterance reference for cancellation
        ttsUtterancesRef.current.push(utterance);

        window.speechSynthesis.speak(utterance);
      };

      speakNext();
    }
  };

  const handleTTSPause = () => {
    window.speechSynthesis.pause();
    setTtsState(prev => ({ ...prev, isPaused: true }));
  };

  const handleTTSResume = () => {
    window.speechSynthesis.resume();
    setTtsState(prev => ({ ...prev, isPaused: false }));
  };

  const handleTTSStop = () => {
    console.log('TTS: Stopping');
    window.speechSynthesis.cancel();
    ttsChunkIndexRef.current = 0;
    ttsUtterancesRef.current = [];
    setTtsState({ isPlaying: false, isPaused: false, currentChunk: 0, totalChunks: 0 });
  };

  if (!summary) return null;

  return (
    <div className="flex items-center gap-2">
      {/* TTS Play Button */}
      {!ttsState.isPlaying ? (
        <button
          onClick={handleTTSPlay}
          className="p-2 rounded-lg hover:bg-dark-card transition-colors border border-gray-700"
          title="Read aloud"
        >
          <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
          </svg>
        </button>
      ) : (
        <div className="flex items-center gap-1">
          {ttsState.isPaused ? (
            <button
              onClick={handleTTSResume}
              className="p-2 rounded-lg hover:bg-dark-card transition-colors border border-gray-700"
              title="Resume"
            >
              <svg className="w-5 h-5 text-accent" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
          ) : (
            <button
              onClick={handleTTSPause}
              className="p-2 rounded-lg hover:bg-dark-card transition-colors border border-gray-700"
              title="Pause"
            >
              <svg className="w-5 h-5 text-accent" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
              </svg>
            </button>
          )}
          <button
            onClick={handleTTSStop}
            className="p-2 rounded-lg hover:bg-dark-card transition-colors border border-gray-700"
            title="Stop"
          >
            <svg className="w-5 h-5 text-danger" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 6h12v12H6z" />
            </svg>
          </button>
        </div>
      )}

      {/* TTS Progress Indicator */}
      {ttsState.isPlaying && ttsState.totalChunks > 0 && (
        <span className="px-2 text-xs text-accent">
          {ttsState.currentChunk}/{ttsState.totalChunks}
        </span>
      )}
    </div>
  );
}

export default TTSPlayer;
