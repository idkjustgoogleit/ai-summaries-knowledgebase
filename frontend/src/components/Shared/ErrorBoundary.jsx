import React, { Component } from 'react';

/**
 * ErrorBoundary component
 * Catches React errors and displays a fallback UI
 */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({
      error: error,
      errorInfo: errorInfo
    });
    
    // Log error to console
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    
    // You could also log to a service here
    // logErrorToService(error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 flex items-center justify-center bg-dark-bg p-4">
          <div className="max-w-md w-full bg-dark-card rounded-lg p-6 border border-gray-700">
            <h2 className="text-xl font-bold text-danger mb-4">
              Something went wrong
            </h2>
            <p className="text-text-secondary mb-4">
              An unexpected error occurred. Please try again or refresh the page.
            </p>
            
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="mb-4">
                <summary className="cursor-pointer text-accent hover:text-accent-hover mb-2">
                  Show error details
                </summary>
                <div className="bg-gray-800 rounded p-3 text-xs text-text-secondary overflow-auto max-h-60">
                  <p className="font-semibold mb-2">Error:</p>
                  <pre className="whitespace-pre-wrap break-all">{this.state.error.toString()}</pre>
                  
                  {this.state.errorInfo && (
                    <>
                      <p className="font-semibold mt-4 mb-2">Component Stack:</p>
                      <pre className="whitespace-pre-wrap break-all">
                        {this.state.errorInfo.componentStack}
                      </pre>
                    </>
                  )}
                </div>
              </details>
            )}
            
            <div className="flex gap-3">
              <button
                onClick={this.handleRetry}
                className="flex-1 bg-accent hover:bg-accent-hover text-white rounded-lg px-4 py-2 font-semibold transition-colors"
              >
                Try Again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="flex-1 bg-gray-600 hover:bg-gray-700 text-white rounded-lg px-4 py-2 font-semibold transition-colors"
              >
                Refresh Page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;