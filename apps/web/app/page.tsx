export default function HomePage() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 640 }}>
      <h1>10xConnect</h1>
      <p>Monorepo skeleton is running. This is a Step 1 placeholder home page.</p>
      <p>
        API health check: <code>GET http://localhost:3001/health</code>
      </p>
    </main>
  );
}
