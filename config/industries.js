export const COMPANY_TYPE_IDS = [
  "independent",
  "small_group",
  "regional",
  "unknown"
];

export const INDUSTRIES = {
  dental: {
    id: "dental",
    label: "Dental",
    noun: "dental practice",
    pluralNoun: "dental practices",
    description: "Independent and small-group practices with valuable clinical services and growth potential.",
    companyTypes: [
      { id: "independent", label: "Independent practice" },
      { id: "small_group", label: "Small dental group" },
      { id: "regional", label: "Regional dental group" },
      { id: "unknown", label: "Ownership unclear" }
    ],
    capabilities: [
      { id: "implants", label: "Dental implants" },
      { id: "fullMouth", label: "Full-mouth rehabilitation" },
      { id: "cosmetic", label: "Cosmetic dentistry" },
      { id: "clearAligners", label: "Clear aligners / Invisalign" },
      { id: "sedation", label: "Sedation dentistry" },
      { id: "oralSurgery", label: "Oral surgery" },
      { id: "sameDay", label: "Same-day dentistry" },
      { id: "emergency", label: "Emergency dentistry" }
    ],
    defaultPriorities: ["implants", "fullMouth", "cosmetic"],
    researchGuidance: [
      "Favor independently owned practices and small local groups.",
      "Look for high-value elective or restorative services and evidence of an active local practice.",
      "National chains and large DSOs are normally poor fits unless the user explicitly includes regional groups."
    ]
  },

  construction: {
    id: "construction",
    label: "Construction & Trades",
    noun: "construction or trade contractor",
    pluralNoun: "construction and trade contractors",
    description: "Contractors, specialty trades, builders, remodelers, and commercial service companies.",
    companyTypes: [
      { id: "independent", label: "Independent contractor" },
      { id: "small_group", label: "Small multi-crew company" },
      { id: "regional", label: "Regional contractor" },
      { id: "unknown", label: "Ownership unclear" }
    ],
    capabilities: [
      { id: "generalContractor", label: "General contracting" },
      { id: "commercialConstruction", label: "Commercial construction" },
      { id: "homeBuilder", label: "Home building" },
      { id: "remodeling", label: "Remodeling" },
      { id: "roofing", label: "Roofing" },
      { id: "hvac", label: "HVAC" },
      { id: "plumbing", label: "Plumbing" },
      { id: "electrical", label: "Electrical" },
      { id: "concrete", label: "Concrete" },
      { id: "excavation", label: "Excavation / site work" },
      { id: "landscaping", label: "Landscaping" },
      { id: "restoration", label: "Restoration" },
      { id: "paving", label: "Paving / asphalt" },
      { id: "masonry", label: "Masonry" },
      { id: "windowsDoors", label: "Windows & doors" },
      { id: "painting", label: "Painting / coatings" }
    ],
    defaultPriorities: ["generalContractor", "roofing", "hvac", "remodeling"],
    researchGuidance: [
      "Favor established local and regional companies with meaningful project values, crews, service areas, or commercial capability.",
      "Positive signals include financing, multiple crews, commercial work, active hiring, strong review volume, expanded territories, and specialized higher-ticket services.",
      "Deprioritize directories, one-person handyman listings, national franchises when ownership is not local, and businesses without a verifiable operating presence."
    ]
  },

  legal: {
    id: "legal",
    label: "Legal Services",
    noun: "law firm",
    pluralNoun: "law firms",
    description: "Independent and regional law firms across consumer and business practice areas.",
    companyTypes: [
      { id: "independent", label: "Independent firm" },
      { id: "small_group", label: "Small / mid-size firm" },
      { id: "regional", label: "Regional firm" },
      { id: "unknown", label: "Firm structure unclear" }
    ],
    capabilities: [
      { id: "personalInjury", label: "Personal injury" },
      { id: "familyLaw", label: "Family law" },
      { id: "estatePlanning", label: "Estate planning" },
      { id: "criminalDefense", label: "Criminal defense" },
      { id: "businessLaw", label: "Business law" },
      { id: "employmentLaw", label: "Employment law" },
      { id: "realEstateLaw", label: "Real estate law" },
      { id: "workersComp", label: "Workers compensation" },
      { id: "civilLitigation", label: "Civil litigation" },
      { id: "bankruptcy", label: "Bankruptcy" },
      { id: "immigration", label: "Immigration" },
      { id: "intellectualProperty", label: "Intellectual property" }
    ],
    defaultPriorities: ["personalInjury", "familyLaw", "estatePlanning", "businessLaw"],
    researchGuidance: [
      "Favor independent firms and regional firms with multiple attorneys, valuable practice areas, multiple offices, or evidence of growth.",
      "Useful signals include attorney hiring, office expansion, strong review activity, visible paid-search competition, and specialized high-value practice areas.",
      "Do not infer client outcomes or sensitive client information. Use only public business and professional information."
    ]
  },

  manufacturing: {
    id: "manufacturing",
    label: "Machine Shops & Light Manufacturing",
    noun: "manufacturer or machine shop",
    pluralNoun: "machine shops and light manufacturers",
    description: "CNC shops, fabricators, tool-and-die companies, plastics firms, and contract manufacturers.",
    companyTypes: [
      { id: "independent", label: "Independent manufacturer" },
      { id: "small_group", label: "Small manufacturing group" },
      { id: "regional", label: "Regional manufacturer" },
      { id: "unknown", label: "Ownership unclear" }
    ],
    capabilities: [
      { id: "cncMachining", label: "CNC machining" },
      { id: "fiveAxis", label: "5-axis machining" },
      { id: "productionMachining", label: "Production machining" },
      { id: "prototype", label: "Prototype work" },
      { id: "fabrication", label: "Metal fabrication" },
      { id: "welding", label: "Welding" },
      { id: "laserCutting", label: "Laser cutting" },
      { id: "toolDie", label: "Tool & die" },
      { id: "plastics", label: "Plastics manufacturing" },
      { id: "injectionMolding", label: "Injection molding" },
      { id: "contractManufacturing", label: "Contract manufacturing" },
      { id: "automation", label: "Industrial automation" },
      { id: "aerospace", label: "Aerospace" },
      { id: "medical", label: "Medical manufacturing" },
      { id: "defense", label: "Defense manufacturing" },
      { id: "isoCertified", label: "ISO-certified operations" }
    ],
    defaultPriorities: ["cncMachining", "fabrication", "contractManufacturing", "fiveAxis"],
    researchGuidance: [
      "Favor established B2B manufacturers with valuable capabilities, multiple machines or processes, specialized end markets, or evidence of capacity growth.",
      "Useful signals include new equipment, facility expansion, certifications, hiring machinists or engineers, added shifts, new capabilities, and aerospace, medical, or defense specialization.",
      "Do not mistake distributors, brokers, directories, or purely consumer product brands for local manufacturing operations."
    ]
  }
};

export function getIndustryConfig(industryId) {
  return INDUSTRIES[industryId] || null;
}

export function getPublicIndustryConfigs() {
  return Object.values(INDUSTRIES).map((industry) => ({
    id: industry.id,
    label: industry.label,
    description: industry.description,
    companyTypes: industry.companyTypes,
    capabilities: industry.capabilities,
    defaultPriorities: industry.defaultPriorities
  }));
}
