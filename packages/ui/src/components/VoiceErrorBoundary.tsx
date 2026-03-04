import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { cn } from '../utils';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class VoiceErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Voice component error:', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center gap-4 p-8 text-center">
          <AlertTriangle className="h-10 w-10 text-red-400" />
          <p className="text-white text-lg">Something went wrong with the voice assistant.</p>
          <p className="text-white/50 text-sm max-w-sm">
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            onClick={this.handleReset}
            className={cn(
              'flex items-center gap-2 px-4 py-2',
              'bg-white/10 backdrop-blur-md rounded-full',
              'text-white text-sm hover:bg-white/20 transition-colors cursor-pointer'
            )}
          >
            <RefreshCw className="h-4 w-4" />
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
