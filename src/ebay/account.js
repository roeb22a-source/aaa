// Account API: Geschäftsrichtlinien + Programme.
import { ebayFetch, hosts } from './http.js';
import { getUserToken } from './auth.js';

const MP = 'marketplace_id=EBAY_DE';

async function list(path, key) {
  const token = await getUserToken();
  const d = await ebayFetch(`${hosts().api}/sell/account/v1/${path}?${MP}`, { token });
  return d[key] || [];
}

export async function isOptedIn() {
  const token = await getUserToken();
  const d = await ebayFetch(`${hosts().api}/sell/account/v1/program/get_opted_in_programs`, { token });
  return (d.programs || []).some((p) => p.programType === 'SELLING_POLICY_MANAGEMENT');
}

export async function optIn() {
  const token = await getUserToken();
  await ebayFetch(`${hosts().api}/sell/account/v1/program/opt_in`, {
    method: 'POST',
    token,
    json: { programType: 'SELLING_POLICY_MANAGEMENT' },
  });
}

export async function loadPolicies() {
  const [f, p, r] = await Promise.all([
    list('fulfillment_policy', 'fulfillmentPolicies'),
    list('payment_policy', 'paymentPolicies'),
    list('return_policy', 'returnPolicies'),
  ]);
  return {
    versand: f.map((x) => ({
      id: x.fulfillmentPolicyId,
      name: x.name,
      abholung: (x.shippingOptions || []).some((o) => o.optionType === 'DOMESTIC' && (o.shippingServices || []).length === 0) || Boolean(x.localPickup),
    })),
    zahlung: p.map((x) => ({ id: x.paymentPolicyId, name: x.name })),
    rueckgabe: r.map((x) => ({ id: x.returnPolicyId, name: x.name })),
  };
}
