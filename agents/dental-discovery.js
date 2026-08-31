import {
  discoverProspects,
  ProspectDiscoveryOutput
} from "./prospect-discovery.js";

/**
 * Backward-compatible wrapper retained for integrations that still import the
 * original dental discovery module.
 */
export async function discoverDentalProspects({
  practiceTypes,
  companyTypes,
  ...options
}) {
  return discoverProspects({
    ...options,
    industry: "dental",
    companyTypes: companyTypes || practiceTypes || ["independent", "small_group"]
  });
}

export { ProspectDiscoveryOutput as DentalDiscoveryOutput };
