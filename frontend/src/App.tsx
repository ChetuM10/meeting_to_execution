import { Routes, Route, Navigate } from "react-router-dom";

// page stubs until we build the real components
function Dashboard() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold text-on-surface">Dashboard</h1>
    </div>
  );
}
function ProjectPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold text-on-surface">Project</h1>
    </div>
  );
}
function SubmitTranscript() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold text-on-surface">
        Submit Transcript
      </h1>
    </div>
  );
}
function ReviewScreen() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold text-on-surface">Review</h1>
    </div>
  );
}
function ExecutionStatus() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold text-on-surface">
        Execution Status
      </h1>
    </div>
  );
}
function Login() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold text-on-surface">Login</h1>
    </div>
  );
}

// sidebar navigation
function Sidebar() {
  return (
    <aside className="w-60 h-screen bg-surface-container-low border-r border-outline-variant flex flex-col">
      <div className="p-4 border-b border-outline-variant">
        <h2 className="text-lg font-semibold text-on-surface">
          Execution Copilot
        </h2>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        <a
          href="/dashboard"
          className="block px-3 py-2 rounded-lg text-sm text-on-surface-variant hover:bg-surface-container-high transition-colors"
        >
          Dashboard
        </a>
        <a
          href="/submit"
          className="block px-3 py-2 rounded-lg text-sm text-on-surface-variant hover:bg-surface-container-high transition-colors"
        >
          Submit Transcript
        </a>
      </nav>
    </aside>
  );
}

export default function App() {
  return (
    <div className="flex h-screen bg-surface">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/projects/:id" element={<ProjectPage />} />
          <Route path="/submit" element={<SubmitTranscript />} />
          <Route path="/review/:id" element={<ReviewScreen />} />
          <Route path="/execution/:id" element={<ExecutionStatus />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  );
}
