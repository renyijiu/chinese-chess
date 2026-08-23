"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type SceneErrorBoundaryProps = {
  children: ReactNode;
  fallback: ReactNode;
  onError: (error: Error) => void;
};

export class SceneErrorBoundary extends Component<SceneErrorBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError(error);
    console.error("Unable to render the Xiangqi board", error, info);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
