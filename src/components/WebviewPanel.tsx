// webviews are managed by Rust/Tauri, not React
// this component just provides the empty space where webviews render
export default function WebviewPanel() {
  return <div className="webview-container" />;
}
