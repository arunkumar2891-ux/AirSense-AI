// Deterministic household guidance. It reads an exposure decision that the
// existing engine already made. It does not score exposure again, and it does
// not call Gemini.

export const INDOOR_NOT_MEASURED = "Indoor air quality has not been measured by AirSense AI.";

const KNOWN = new Set(["suitable", "caution", "avoid"]);
const USABLE_FRESHNESS = new Set(["fresh", "aging"]);
const ROUTINES = new Set([
  "running",
  "cycling",
  "outdoor workout",
  "sports",
  "commuting",
  "daily activities",
  "children's outdoor play",
]);

function card(fields) {
  return {
    id: fields.id,
    category: fields.category,
    title: fields.title,
    description: fields.description,
    whyItHelps: fields.whyItHelps,
    impactType: fields.impactType,
    limitations: fields.limitations,
  };
}

function indoorCard(fields) {
  const limitations = fields.limitations.includes(INDOOR_NOT_MEASURED)
    ? fields.limitations
    : `${fields.limitations} ${INDOOR_NOT_MEASURED}`;
  return card({ ...fields, limitations });
}

function airUnusable(recommendation, freshnessState) {
  return recommendation === "insufficient_data" || !USABLE_FRESHNESS.has(freshnessState);
}

function travelAllowed(travel) {
  const recommendation = travel?.recommendation;
  return travel?.eligible === true && (recommendation === "suitable" || recommendation === "caution");
}

function ventilationCards(recommendation, freshnessState, scheduleStatus, suitableWindowCount) {
  if (airUnusable(recommendation, freshnessState)) {
    return [indoorCard({
      id: "ventilation_withheld",
      category: "ventilation",
      title: "Do not open windows from this reading",
      description: "Outdoor air data is missing or stale, so AirSense does not suggest opening windows or bringing outdoor air in.",
      whyItHelps: "Waiting for a usable outdoor reading avoids treating missing or old data as a reason to ventilate.",
      impactType: "personal_exposure",
      limitations: "A missing or stale outdoor reading does not describe the air inside the home. A forecast does not guarantee indoor air.",
    })];
  }

  const cards = [];
  if (recommendation === "suitable") {
    cards.push(indoorCard({
      id: "ventilation_when_outdoor_suitable",
      category: "ventilation",
      title: "Consider ventilating while outdoor air is suitable",
      description: "The current outdoor reading is suitable. Opening windows, or using ventilation that brings outdoor air in, is a general option for a short time.",
      whyItHelps: "Outdoor air the exposure engine currently calls suitable can dilute some pollutants that come from indoors. That is a general practice for indoor sources, not a measured result for this home.",
      impactType: "indoor_pollution_sources",
      limitations: "A suitable outdoor reading does not guarantee indoor air. This is not a promise that the home is free of pollutants.",
    }));
  } else if (recommendation === "caution" || recommendation === "avoid") {
    const named = recommendation === "caution" ? "caution" : "avoid";
    cards.push(indoorCard({
      id: "ventilation_limit_outdoor_intake",
      category: "ventilation",
      title: `Limit unnecessary outdoor-air intake while the outdoor reading is ${named}`,
      description: "Avoid bringing extra outdoor air in through open windows or outdoor-air intakes while you do not need that air.",
      whyItHelps: "Less unnecessary outdoor-air intake can limit how much of the current outdoor pollution enters the home. It does not remove pollution already indoors.",
      impactType: "personal_exposure",
      limitations: "This does not say the home is safe or unsafe. Do not seal the home in a way that creates another hazard. A forecast does not guarantee indoor air.",
    }));
  }

  if (scheduleStatus === "suitable_windows" && suitableWindowCount > 0) {
    cards.push(indoorCard({
      id: "ventilation_during_suitable_window",
      category: "ventilation",
      title: "A suitable forecast period is a ventilation option",
      description: "The household may consider ventilating during a suitable period in the outing windows, instead of assuming every later hour is the same.",
      whyItHelps: "A suitable forecast window is the same outdoor-exposure rule already used for the outing. It is a timing option, not a new score.",
      impactType: "personal_exposure",
      limitations: "A forecast window does not guarantee indoor air, and it does not measure the home.",
    }));
  }
  return cards;
}

function sourceControlCards() {
  return [
    indoorCard({
      id: "cooking_exhaust",
      category: "source_control",
      title: "Manage cooking emissions",
      description: "Use a lid when practical, and run an exhaust fan or other kitchen ventilation that sends cooking air outdoors.",
      whyItHelps: "Cooking is a common indoor particle and gas source. Sending that air outdoors reduces the source inside the home.",
      impactType: "indoor_pollution_sources",
      limitations: "This does not estimate how much cooking pollution remains. A fan that only recirculates air is not the same as exhausting outdoors.",
    }),
    indoorCard({
      id: "smoking_incense",
      category: "source_control",
      title: "Avoid indoor smoking and incense",
      description: "Keep smoking and incense outside the home rather than burning them in living spaces.",
      whyItHelps: "Smoke and incense add indoor particles and gases at the source, separate from the outdoor reading.",
      impactType: "indoor_pollution_sources",
      limitations: "Avoiding these sources does not measure or clear pollution that is already indoors.",
    }),
    indoorCard({
      id: "aerosols_cleaning",
      category: "source_control",
      title: "Reduce sprays and harsh cleaners",
      description: "Skip aerosol sprays and harsh cleaning products when a simpler cleaner will do.",
      whyItHelps: "Sprays and harsh products add indoor chemicals that the outdoor air reading does not describe.",
      impactType: "indoor_pollution_sources",
      limitations: "This is source control only. It is not a measured indoor concentration.",
    }),
    indoorCard({
      id: "damp_dust",
      category: "source_control",
      title: "Dust with a damp method",
      description: "Use a damp cloth or mop so dust is captured instead of being sent back into the room.",
      whyItHelps: "Dry dusting can put settled particles back into the air people breathe indoors.",
      impactType: "indoor_pollution_sources",
      limitations: "Damp cleaning does not quantify indoor particles and does not replace ventilation or filtration.",
    }),
  ];
}

function filtrationCard() {
  return indoorCard({
    id: "particle_filtration",
    category: "filtration",
    title: "Particle filtration may reduce indoor particles",
    description: "An appropriately sized and maintained particle filter, such as a portable cleaner used as its maker directs, may help reduce particles in the room where it runs.",
    whyItHelps: "Filtration can lower particles that come from indoor sources or that have already entered. The benefit is about those particles, not outdoor emissions.",
    impactType: "indoor_pollution_sources",
    limitations: "AirSense does not claim a particular purifier will reach a specific reduction. Houseplants are not a substitute for filtration. No indoor result has been measured.",
  });
}

function outdoorRoutineCard(id, title, activity, recommendation, unusable, hasWindow) {
  let description;
  if (unusable) {
    description = `Do not assume ${activity} is suitable outdoors. Wait for a usable reading or choose an indoor alternative.`;
  } else if (recommendation === "avoid") {
    description = `${activity} is not suitable outdoors on this reading. Reschedule it or use an indoor alternative.`;
  } else if (hasWindow) {
    description = `If you do ${activity} outdoors, use a suitable outing window. An indoor alternative remains available.`;
  } else {
    description = `No suitable outing window was found for ${activity}. Reschedule it or use an indoor alternative rather than assuming a later hour is suitable.`;
  }
  return card({
    id,
    category: "routine",
    title,
    description,
    whyItHelps: "This follows the household outdoor decision already made by the exposure engine. It does not create a second score.",
    impactType: "personal_exposure",
    limitations: "Moving the activity indoors may reduce outdoor exposure. It is not automatically an emissions reduction. An adult result is not permission for a child's outdoor activity.",
  });
}

function childPlayCard(recommendation, unusable, hasWindow) {
  let description;
  if (unusable) {
    description = "Do not send children outside to play from a missing or stale outdoor reading.";
  } else if (recommendation === "avoid") {
    description = "Keep children's outdoor play indoors or rescheduled. The governing child decision is avoid.";
  } else if (recommendation === "caution" && hasWindow) {
    description = "Children's outdoor play follows the child decision, which is caution. If you go out, use a suitable outing window.";
  } else if (recommendation === "suitable" && hasWindow) {
    description = "Children's outdoor play follows the child decision, which is suitable. A suitable outing window is the timing option.";
  } else if (recommendation === "caution" || recommendation === "suitable") {
    description = "Children's outdoor play follows the child decision. No suitable outing window was found, so do not assume a later hour is suitable.";
  } else {
    description = "Children's outdoor play follows the governing child decision. Do not substitute another result.";
  }
  return card({
    id: "child_outdoor_play",
    category: "routine",
    title: "Children's outdoor play follows the child decision",
    description,
    whyItHelps: "The child profile is the household outing. Using it keeps a less restrictive adult result from permitting the child's outdoor activity.",
    impactType: "personal_exposure",
    limitations: "This is the governing child result and the household GoWindow. An adult result is not permission for the child. Moving play indoors may reduce outdoor exposure and is not automatically an emissions reduction.",
  });
}

function commuteCard() {
  return card({
    id: "commute_fewer_vehicle_trips",
    category: "sustainable",
    title: "Reduce unnecessary vehicle trips",
    description: "For the adult commute, consider public transport, carpooling, combining errands, or skipping a trip that is not needed.",
    whyItHelps: "Fewer or shared vehicle trips can potentially reduce transport-related emissions. That is an ambient-emissions possibility, not a change measured at home.",
    impactType: "ambient_emissions",
    limitations: "AirSense does not calculate an emissions quantity. Public transport and carpooling do not eliminate exposure while waiting outdoors. This adult commute does not permit a child's outdoor activity.",
  });
}

function activeTravelCard(mode, allowed, recommendation) {
  const name = mode === "walking" ? "Walking" : "Cycling";
  if (!allowed) {
    const because = recommendation === "insufficient_data" ? "outdoor data is missing or stale" : "the engine result is avoid";
    return card({
      id: mode === "walking" ? "walking_withheld" : "cycling_withheld",
      category: "routine",
      title: `${name} is not recommended for this traveler`,
      description: `${name} is not offered right now because ${because}. Do not inherit an adult result to allow it.`,
      whyItHelps: "Withholding the trip keeps a favorable adult result from being treated as the traveler's permission.",
      impactType: "personal_exposure",
      limitations: "This gate uses the governing traveler's existing engine result. It is not a new score.",
    });
  }
  return card({
    id: mode === "walking" ? "walking_when_engine_allows" : "cycling_when_engine_allows",
    category: "sustainable",
    title: `${name} is an option for this traveler`,
    description: `${name} can replace a short vehicle trip while this traveler's engine result is suitable or caution.`,
    whyItHelps: "Replacing a vehicle trip can potentially reduce transport-related emissions. The person is still outdoors, so the exposure result still applies.",
    impactType: "ambient_emissions",
    limitations: "Offer this only for the governing traveler's suitable or caution result. It does not remove exposure outdoors, and it is not a calculated emissions saving. An adult result is not permission for a child.",
  });
}

function impactExplanations(used) {
  const explanations = [];
  if (used.has("personal_exposure")) {
    explanations.push(card({
      id: "impact_personal_exposure",
      category: "impact",
      title: "Personal exposure",
      description: "These actions change when people are outdoors or how much outdoor air comes in.",
      whyItHelps: "They apply the outdoor decision you already have. They do not measure the air inside.",
      impactType: "personal_exposure",
      limitations: "No outdoor or indoor pollutant reduction is quantified.",
    }));
  }
  if (used.has("indoor_pollution_sources")) {
    explanations.push(card({
      id: "impact_indoor_sources",
      category: "impact",
      title: "Indoor pollution sources",
      description: "These actions deal with pollution generated inside the home, such as cooking, smoke, sprays, and dust.",
      whyItHelps: "Reducing a source can mean less of that pollution in the room. The outdoor score is a separate question.",
      impactType: "indoor_pollution_sources",
      limitations: "Indoor air quality has not been measured by AirSense AI. No indoor concentration is estimated.",
    }));
  }
  if (used.has("ambient_emissions")) {
    explanations.push(card({
      id: "impact_ambient_emissions",
      category: "impact",
      title: "Potential ambient emissions",
      description: "Fewer or shared vehicle trips can potentially reduce transport-related emissions.",
      whyItHelps: "That possibility is about emissions to the wider air, not a measured improvement at the home.",
      impactType: "ambient_emissions",
      limitations: "Moving an activity indoors may reduce outdoor exposure, but it is not automatically an emissions reduction. No emissions quantity or percent change is calculated.",
    }));
  }
  return explanations;
}

export function familyRulesExplanation(plan) {
  const recommendation = plan?.decision?.activityRecommendation;
  const known = recommendation === "suitable" || recommendation === "caution" || recommendation === "avoid" || recommendation === "insufficient_data";
  const decisionWord = known ? String(recommendation).replaceAll("_", " ") : "insufficient data";
  const child = plan?.basis?.childPresent === true
    ? "Every age group in the household is checked and the most protective result applies. An adult result is not permission for the child."
    : "Every age group in the household is checked and the most protective result applies.";
  const schedule = String(plan?.schedule?.status || "insufficient_data").replaceAll("_", " ");
  const scheduleSentence = recommendation === "insufficient_data"
    ? "The outing schedule is withheld because the current data is not usable."
    : `The outing schedule status is ${schedule}.`;
  const travel = plan?.activeTravel?.walking?.eligible === true || plan?.activeTravel?.cycling?.eligible === true
    ? "Active travel is mentioned only where the governing traveler is already eligible."
    : "Walking and cycling are not offered for the governing traveler.";
  return `The household decision is ${decisionWord}. ${child} ${scheduleSentence} Indoor air quality has not been measured by AirSense AI, so ventilation and source-control guidance stay general and do not guarantee indoor air. Emissions comments are qualitative only and are not a calculated saving. ${travel} This is not medical advice and it does not recommend treatment.`;
}

/**
 * Build indoor, routine, and impact guidance from a plan the exposure engine
 * already produced. Extra fields are ignored, so a caller cannot pass a
 * client air reading or an adult permission flag.
 */
export function buildFamilyGuidance(input = {}) {
  const recommendation = KNOWN.has(input.recommendation) || input.recommendation === "insufficient_data"
    ? input.recommendation
    : "insufficient_data";
  const freshnessState = typeof input.freshnessState === "string" ? input.freshnessState : "unknown";
  const scheduleStatus = typeof input.scheduleStatus === "string" ? input.scheduleStatus : "insufficient_data";
  const suitableWindowCount = Number.isInteger(input.suitableWindowCount) && input.suitableWindowCount > 0
    ? input.suitableWindowCount
    : 0;
  const routines = new Set(
    (Array.isArray(input.routines) ? input.routines : []).filter((routine) => ROUTINES.has(routine)),
  );
  const childPresent = input.childPresent === true;
  const unusable = airUnusable(recommendation, freshnessState);
  const hasWindow = !unusable && scheduleStatus === "suitable_windows" && suitableWindowCount > 0;

  const indoor = [
    ...ventilationCards(recommendation, freshnessState, hasWindow ? scheduleStatus : "insufficient_data", hasWindow ? suitableWindowCount : 0),
    ...sourceControlCards(),
    filtrationCard(),
  ];

  const routineRecommendations = [];
  if (childPresent) routineRecommendations.push(childPlayCard(recommendation, unusable, hasWindow));
  if (routines.has("running")) {
    routineRecommendations.push(outdoorRoutineCard(
      "running_follow_outdoor_decision",
      "Running follows the household outdoor decision",
      "running",
      recommendation,
      unusable,
      hasWindow,
    ));
  }
  if (routines.has("outdoor workout")) {
    routineRecommendations.push(outdoorRoutineCard(
      "outdoor_workout_follow_outdoor_decision",
      "Outdoor workouts follow the household outdoor decision",
      "an outdoor workout",
      recommendation,
      unusable,
      hasWindow,
    ));
  }
  if (routines.has("sports")) {
    routineRecommendations.push(outdoorRoutineCard(
      "sports_follow_outdoor_decision",
      "Sports follow the household outdoor decision",
      "sport",
      recommendation,
      unusable,
      hasWindow,
    ));
  }

  const walkingAllowed = travelAllowed(input.walking);
  const cyclingAllowed = travelAllowed(input.cycling);
  if (routines.has("commuting")) {
    routineRecommendations.push(commuteCard());
    routineRecommendations.push(activeTravelCard("walking", walkingAllowed, input.walking?.recommendation));
    routineRecommendations.push(activeTravelCard("cycling", cyclingAllowed, input.cycling?.recommendation));
  } else if (routines.has("cycling")) {
    routineRecommendations.push(activeTravelCard("cycling", cyclingAllowed, input.cycling?.recommendation));
  }

  const used = new Set([...indoor, ...routineRecommendations].map((item) => item.impactType));
  return {
    indoorMeasurementStatus: "not_measured",
    emissionsImpactStatus: "qualitative_only",
    indoorGuidance: {
      measurementStatement: INDOOR_NOT_MEASURED,
      recommendations: indoor,
    },
    routineRecommendations,
    impactExplanations: impactExplanations(used),
  };
}
