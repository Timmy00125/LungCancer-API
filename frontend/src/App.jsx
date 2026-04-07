import { useState, useEffect, useMemo } from 'react'
import './App.css'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

const PREPOPULATED_CITY_ZIPS = {
  Austin: ['73301', '78701', '78704', '78705'],
  Dallas: ['75201', '75204', '75208', '75219'],
  Houston: ['77001', '77002', '77019', '77056'],
  SanAntonio: ['78201', '78205', '78209', '78230'],
  Chicago: ['60601', '60605', '60611', '60614'],
  Phoenix: ['85001', '85004', '85012', '85016'],
  Philadelphia: ['19103', '19104', '19107', '19147'],
  SanDiego: ['92101', '92103', '92109', '92122'],
  LosAngeles: ['90001', '90012', '90017', '90049'],
  SanJose: ['95110', '95112', '95123', '95126'],
  NewYork: ['10001', '10003', '10019', '10025'],
  Boston: ['02108', '02110', '02116', '02118'],
  Seattle: ['98101', '98103', '98105', '98109'],
  Denver: ['80202', '80203', '80205', '80206'],
  Miami: ['33101', '33130', '33131', '33139'],
}

const formatCityLabel = (cityKey) => cityKey.replace(/([a-z])([A-Z])/g, '$1 $2')

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

  const normalizeLocationPart = (value) => value.trim()

  const { cityOptions, zipOptionsForSelectedCity, zipToCities, cityToZips, allZipOptions } = useMemo(() => {
    const cities = new Set()
    const cityToZipsMap = new Map()
    const zipToCitiesMap = new Map()

    Object.entries(PREPOPULATED_CITY_ZIPS).forEach(([cityKey, zipCodes]) => {
      const cleanCity = formatCityLabel(cityKey)
      cities.add(cleanCity)

      if (!cityToZipsMap.has(cleanCity)) {
        cityToZipsMap.set(cleanCity, new Set())
      }

      zipCodes.forEach((zipCodeValue) => {
        const cleanZip = normalizeLocationPart(zipCodeValue)
        cityToZipsMap.get(cleanCity).add(cleanZip)

        if (!zipToCitiesMap.has(cleanZip)) {
          zipToCitiesMap.set(cleanZip, new Set())
        }
        zipToCitiesMap.get(cleanZip).add(cleanCity)
      })
    })

    history.forEach((record) => {
      const cleanCity = normalizeLocationPart(record.city || '')
      const cleanZip = normalizeLocationPart(record.zip_code || '')

      if (cleanCity) {
        cities.add(cleanCity)
      }

      if (cleanCity && cleanZip) {
        if (!cityToZipsMap.has(cleanCity)) {
          cityToZipsMap.set(cleanCity, new Set())
        }
        cityToZipsMap.get(cleanCity).add(cleanZip)

        if (!zipToCitiesMap.has(cleanZip)) {
          zipToCitiesMap.set(cleanZip, new Set())
        }
        zipToCitiesMap.get(cleanZip).add(cleanCity)
      }
    })

    const allZips = [...zipToCitiesMap.keys()].sort((a, b) => a.localeCompare(b))
    const sortedCities = [...cities].sort((a, b) => a.localeCompare(b))
    const selectedCity = normalizeLocationPart(city)
    const cityZipSet = cityToZipsMap.get(selectedCity) || new Set()
    const sortedZipForSelectedCity = selectedCity
      ? [...cityZipSet].sort((a, b) => a.localeCompare(b))
      : allZips

    return {
      cityOptions: sortedCities,
      zipOptionsForSelectedCity: sortedZipForSelectedCity,
      zipToCities: zipToCitiesMap,
      cityToZips: cityToZipsMap,
      allZipOptions: allZips,
    }
  }, [history, city])

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
              placeholder="Search city (e.g., Austin)"
              value={city}
              list="city-options"
              onChange={(e) => {
                const nextCity = e.target.value
                setCity(nextCity)

                const normalizedNextCity = normalizeLocationPart(nextCity)
                if (!normalizedNextCity || !zipCode) {
                  return
                }

                const zipAllowedForCity = (cityToZips.get(normalizedNextCity) || new Set()).has(
                  zipCode.trim()
                )
                if (!zipAllowedForCity) {
                  setZipCode('')
                }
              }}
            />
            <datalist id="city-options">
              {cityOptions.map((cityOption) => (
                <option key={cityOption} value={cityOption} />
              ))}
            </datalist>
            <input
              type="text"
              placeholder={city.trim() ? 'Search ZIP for selected city' : 'Search ZIP (e.g., 73301)'}
              value={zipCode}
              list="zip-options"
              onChange={(e) => {
                const nextZip = e.target.value
                setZipCode(nextZip)

                const normalizedZip = normalizeLocationPart(nextZip)
                if (!normalizedZip || city.trim()) {
                  return
                }

                const linkedCities = zipToCities.get(normalizedZip)
                if (linkedCities && linkedCities.size === 1) {
                  setCity([...linkedCities][0])
                }
              }}
            />
            <datalist id="zip-options">
              {zipOptionsForSelectedCity.map((zipOption) => (
                <option key={zipOption} value={zipOption} />
              ))}
            </datalist>
          </div>
          {city.trim() && (
            <p className="location-helper-text">
              {zipOptionsForSelectedCity.length > 0
                ? `${zipOptionsForSelectedCity.length} ZIP code(s) found for ${city.trim()}.`
                : `No ZIP code history found yet for ${city.trim()}.`}
            </p>
          )}
          {!city.trim() && allZipOptions.length > 0 && (
            <p className="location-helper-text">
              {allZipOptions.length} ZIP code(s) available. Select a city to narrow the list.
            </p>
          )}
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
