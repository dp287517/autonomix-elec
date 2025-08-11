function calculateAdjustedLifespan(disjoncteur) {
  const lifespan = parseInt(disjoncteur.lifespan) || 30;
  let humidityFactor = 1.0;
  let temperatureFactor = 1.0;
  let loadFactor = 1.0;
  let criticalReason = [];

  const humidite = parseFloat(disjoncteur.humidite) || 50;
  if (humidite > 70) {
    const excess = (humidite - 70) / 10;
    humidityFactor = Math.max(0.5, 1.0 - (0.1 * excess));
    criticalReason.push(`Humidité élevée (${humidite}%)`);
  }

  const temp_ambiante = parseFloat(disjoncteur.temp_ambiante) || 25;
  if (temp_ambiante > 40) {
    const excess = (temp_ambiante - 40) / 5;
    temperatureFactor = Math.max(0.5, 1.0 - (0.05 * excess));
    criticalReason.push(`Température élevée (${temp_ambiante}°C)`);
  } else if (temp_ambiante < -5) {
    const excess = (-5 - temp_ambiante) / 5;
    temperatureFactor = Math.max(0.5, 1.0 - (0.05 * excess));
    criticalReason.push(`Température basse (${temp_ambiante}°C)`);
  }

  const charge = parseFloat(disjoncteur.charge) || 80;
  if (charge > 80) {
    const excess = (charge - 80) / 10;
    loadFactor = Math.max(0.5, 1.0 - (0.05 * excess));
    criticalReason.push(`Surcharge (${charge}%)`);
  }

  const adjustedLifespan = Math.round(lifespan * humidityFactor * temperatureFactor * loadFactor);
  const isCritical = adjustedLifespan <= 5 || criticalReason.length > 0;

  return {
    adjustedLifespan,
    isCritical,
    criticalReason: criticalReason.length ? criticalReason.join(', ') : null
  };
}

module.exports = { calculateAdjustedLifespan };
