import { useState, useEffect } from 'react'
import './App.css'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

function App() {
  const [selectedFile, setSelectedFile] = useState(null)
  const [city, setCity] = useState('')
  const [zipCode, setZipCode] = useState('')
  const [minSamples, setMinSamples] = useState(1)
  const [prediction, setPrediction] = useState(null)
  const [history, setHistory] = useState([])
  const [communityRisk, setCommunityRisk] = useState([])
  const [loading, setLoading] = useState(false)
  const [dashboardLoading, setDashboardLoading] = useState(false)

  const fetchHistory = async () => {
    try {
      const res = await fetch(`${API_BASE}/predictions`)
      const data = await res.json()
      setHistory(data)
    } catch (err) {
      console.error("Error fetching history", err)
    }
  }

  const fetchCommunityRisk = async (sampleThreshold = minSamples) => {
    setDashboardLoading(true)
    try {
      const res = await fetch(
        `${API_BASE}/predictions/community-risk?min_samples=${sampleThreshold}`
      )
      const data = await res.json()
      setCommunityRisk(data)
    } catch (err) {
      console.error('Error fetching community risk', err)
      setCommunityRisk([])
    } finally {
      setDashboardLoading(false)
    }
  }

  useEffect(() => {
    fetchHistory()
  }, [])

  useEffect(() => {
    fetchCommunityRisk()
  }, [minSamples])

  const handleFileChange = (e) => {
    setSelectedFile(e.target.files[0])
    setPrediction(null)
  }

  const handleUpload = async () => {
    if (!selectedFile) return
    const normalizedCity = city.trim()
    const normalizedZip = zipCode.trim()

    if (!normalizedCity && !normalizedZip) {
      alert('Please add a city or zip code before analyzing.')
      return
    }

    setLoading(true)

    const formData = new FormData()
    formData.append("file", selectedFile)
    if (normalizedCity) formData.append('city', normalizedCity)
    if (normalizedZip) formData.append('zip_code', normalizedZip)

    try {
      const res = await fetch(`${API_BASE}/predict`, {
        method: "POST",
        body: formData
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.detail || 'Prediction failed')
      }

      const data = await res.json()
      setPrediction(data)
      fetchHistory() // refresh history
      fetchCommunityRisk(minSamples) // refresh dashboard
    } catch (err) {
      console.error("Prediction failed:", err)
      alert("Prediction failed. Make sure backend is running and location is provided.")
    } finally {
      setLoading(false)
    }
  }

  const totalSamples = communityRisk.reduce(
    (sum, row) => sum + row.total_predictions,
    0
  )
  const totalCancerous = communityRisk.reduce(
    (sum, row) => sum + row.cancerous_cases,
    0
  )
  const overallRisk =
    totalSamples > 0 ? ((totalCancerous / totalSamples) * 100).toFixed(1) : '0.0'

  const riskClassFromRate = (rate) => {
    if (rate >= 0.7) return 'risk-very-high'
    if (rate >= 0.5) return 'risk-high'
    if (rate >= 0.3) return 'risk-medium'
    return 'risk-low'
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
          <div className="location-fields">
            <input
              type="text"
              placeholder="City (e.g., Austin)"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            />
            <input
              type="text"
              placeholder="Zip code (e.g., 73301)"
              value={zipCode}
              onChange={(e) => setZipCode(e.target.value)}
            />
          </div>
          <button onClick={handleUpload} disabled={!selectedFile || loading}>
            {loading ? "Analyzing..." : "Analyze Image"}
          </button>
          
          {prediction && (
            <div className="prediction-result">
              <h3>Result: {prediction.prediction.toUpperCase()}</h3>
              <p><strong>Detailed Class:</strong> {prediction.detailed_class}</p>
              <p><strong>Confidence:</strong> {(prediction.confidence * 100).toFixed(2)}%</p>
              <p>
                <strong>Location:</strong> {prediction.zip_code || prediction.city}
              </p>
            </div>
          )}
        </section>

        <section className="dashboard-section">
          <h2>Community Risk Dashboard</h2>
          <div className="dashboard-controls">
            <label htmlFor="min-samples">Minimum samples per location</label>
            <select
              id="min-samples"
              value={minSamples}
              onChange={(e) => setMinSamples(Number(e.target.value))}
            >
              <option value={1}>1+ samples</option>
              <option value={3}>3+ samples</option>
              <option value={5}>5+ samples</option>
              <option value={10}>10+ samples</option>
            </select>
          </div>
          <div className="risk-legend" aria-label="risk level legend">
            <span className="legend-item">
              <i className="legend-dot risk-low" />
              Low: &lt; 30%
            </span>
            <span className="legend-item">
              <i className="legend-dot risk-medium" />
              Medium: 30% - 49.9%
            </span>
            <span className="legend-item">
              <i className="legend-dot risk-high" />
              High: 50% - 69.9%
            </span>
            <span className="legend-item">
              <i className="legend-dot risk-very-high" />
              Very High: 70%+
            </span>
          </div>
          <div className="dashboard-metrics">
            <article className="metric-card">
              <span>Total Samples</span>
              <strong>{totalSamples}</strong>
            </article>
            <article className="metric-card">
              <span>Cancerous Cases</span>
              <strong>{totalCancerous}</strong>
            </article>
            <article className="metric-card">
              <span>Overall Community Risk</span>
              <strong>{overallRisk}%</strong>
            </article>
          </div>

          {dashboardLoading ? (
            <p>Loading community risk...</p>
          ) : communityRisk.length === 0 ? (
            <p>
              No community data matches this filter yet. Try lowering the minimum sample
              threshold or submit more predictions with city/zip.
            </p>
          ) : (
            <>
              <div className="risk-grid">
                {communityRisk.map((row) => (
                  <article
                    key={`${row.location_type}-${row.location}`}
                    className={`risk-card ${riskClassFromRate(row.cancerous_rate)}`}
                  >
                    <h3>{row.location}</h3>
                    <p>{row.location_type === 'zip_code' ? 'Zip Code' : 'City'}</p>
                    <strong>{(row.cancerous_rate * 100).toFixed(1)}% risk</strong>
                    <span>{row.total_predictions} samples</span>
                  </article>
                ))}
              </div>

              <table className="history-table">
                <thead>
                  <tr>
                    <th>Location</th>
                    <th>Type</th>
                    <th>Total</th>
                    <th>Cancerous</th>
                    <th>Non-Cancerous</th>
                    <th>Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {communityRisk.map((row) => (
                    <tr key={`table-${row.location_type}-${row.location}`}>
                      <td>{row.location}</td>
                      <td>{row.location_type}</td>
                      <td>{row.total_predictions}</td>
                      <td>{row.cancerous_cases}</td>
                      <td>{row.non_cancerous_cases}</td>
                      <td>{(row.cancerous_rate * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
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
                  <th>Location</th>
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
                    <td>{record.zip_code || record.city || 'N/A'}</td>
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
