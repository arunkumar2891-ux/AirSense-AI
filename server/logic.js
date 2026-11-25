export function getAQIStatus(value) {
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return { label: "Unavailable", color: "slate", level: 0, advice: "Live AQI is unavailable. Check your local monitoring authority." };
  const aqi = Number(value);
  if (aqi <= 50) return { label: "Good", color: "green", level: 1, advice: "Air quality is generally satisfactory for outdoor activities." };
  if (aqi <= 100) return { label: "Moderate", color: "yellow", level: 2, advice: "Most people can continue usual activities; unusually sensitive people should monitor symptoms." };
  if (aqi <= 150) return { label: "Unhealthy for sensitive groups", color: "orange", level: 3, advice: "Sensitive groups should reduce prolonged or heavy outdoor exertion." };
  if (aqi <= 200) return { label: "Unhealthy", color: "red", level: 4, advice: "Consider reducing prolonged outdoor exertion; sensitive groups should avoid it." };
  if (aqi <= 300) return { label: "Very unhealthy", color: "purple", level: 5, advice: "Avoid outdoor exertion where possible and follow local public-health guidance." };
  return { label: "Hazardous", color: "maroon", level: 6, advice: "Avoid outdoor activity and follow official emergency health guidance." };
}

export function buildRecommendationContext(air = {}, profile = {}, question = "") {
  const aqi = Number(air.aqi);
  const status = getAQIStatus(aqi);
  const activity = String(profile.activity || "daily activities");
  const sensitivity = String(profile.sensitivity || "general");
  const ageGroup = String(profile.ageGroup || "adult");
  const valid = air.aqi !== null && air.aqi !== undefined && air.aqi !== "" && Number.isFinite(aqi);
  let recommendation = valid ? status.advice : "I don't have a current AQI reading, so I can't make a live exposure recommendation. Check an official local monitor.";
  if (valid && aqi > 100 && ["running", "cycling", "outdoor workout", "sports"].includes(activity.toLowerCase())) {
    recommendation += " Because you plan vigorous outdoor activity, choose an indoor session or wait for a lower reading.";
  }
  if (valid && aqi > 100 && (sensitivity !== "general" || ageGroup === "child" || ageGroup === "older adult")) {
    recommendation += " Take extra care because the selected profile may be more sensitive to air pollution.";
  }
  const answer = `${valid ? `The reported ${air.aqiScale || "AQI"} is ${aqi} (${status.label}).` : "Current air quality data is unavailable."} ${recommendation} ${air.pollutants?.pm25 != null ? `PM2.5 is ${air.pollutants.pm25} µg/m³.` : ""} ${air.attribution || ""}`.trim();
  return { aqi: valid ? aqi : null, category: status.label, activity, sensitivity, ageGroup, recommendation, question, answer };
}
