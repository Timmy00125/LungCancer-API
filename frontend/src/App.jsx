import { useState, useEffect } from 'react'
import './App.css'

function App() {
  const [selectedFile, setSelectedFile] = useState(null)
  const [prediction, setPrediction] = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)

  const fetchHistory = async () => {
    try {
      const res = await fetch("http://localhost:8000/predictions")
      const data = await res.json()
      setHistory(data)
    } catch (err) {
      console.error("Error fetching history", err)
    }
  }

  useEffect(() => {
    fetchHistory()
  }, [])

  const handleFileChange = (e) => {
    setSelectedFile(e.target.files[0])
    setPrediction(null)
  }

  const handleUpload = async () => {
    if (!selectedFile) return
    setLoading(true)

    const formData = new FormData()
    formData.append("file", selectedFile)

    try {
      const res = await fetch("http://localhost:8000/predict", {
        method: "POST",
        body: formData
      })
      const data = await res.json()
      setPrediction(data)
      fetchHistory() // refresh history
    } catch (err) {
      console.error("Prediction failed:", err)
      alert("Prediction failed. Make sure backend is running.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="app-container">
      <header className="header">
        <h1>PredictiX - Lung Cancer API</h1>
      </header>

      <main className="main-content">
        <section className="upload-section">
          <h2>Predict New Image</h2>
          <input type="file" accept="image/*" onChange={handleFileChange} />
          <button onClick={handleUpload} disabled={!selectedFile || loading}>
            {loading ? "Analyzing..." : "Analyze Image"}
          </button>
          
          {prediction && (
            <div className="prediction-result">
              <h3>Result: {prediction.prediction.toUpperCase()}</h3>
              <p><strong>Detailed Class:</strong> {prediction.detailed_class}</p>
              <p><strong>Confidence:</strong> {(prediction.confidence * 100).toFixed(2)}%</p>
            </div>
          )}
        </section>

        <section className="history-section">
          <h2>Recent Predictions</h2>
          {history.length === 0 ? (
            <p>No predictions yet.</p>
          ) : (
            <table className="history-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Filename</th>
                  <th>Result</th>
                  <th>Class</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {history.map((record) => (
                  <tr key={record.id}>
                    <td>{record.id}</td>
                    <td>{record.filename}</td>
                    <td className={record.prediction === 'cancerous' ? 'danger' : 'safe'}>
                      {record.prediction}
                    </td>
                    <td>{record.detailed_class}</td>
                    <td>{new Date(record.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </div>
  )
}

export default App
