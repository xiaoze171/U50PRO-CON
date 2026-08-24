import { numeric } from './format.js';

function normalizeBand(raw) {
  const match = String(raw || '').match(/\d+/);
  return match ? Number(match[0]) : null;
}

function nrPciDecimal(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const parsed = Number.parseInt(text, /[a-f]/i.test(text) ? 16 : 10);
  return Number.isInteger(parsed) ? parsed : null;
}

export function inferScs(band) {
  return [41, 77, 78, 79].includes(Number(band)) ? 30 : 15;
}

export function buildCellCandidates(data) {
  const signal = data.signal || {};
  const neighbors = data.neighbors || {};
  const network = String(signal.network_type || neighbors.network_type || '').toUpperCase();
  const rows = [];

  if (network.includes('SA') || network.includes('NR5G') || signal.nr5g_action_channel) {
    const band = normalizeBand(signal.nr5g_action_band);
    const serving = {
      rat: 'NR',
      mode: network.includes('NSA') ? 'nsa' : 'sa',
      pci: nrPciDecimal(signal.nr5g_pci),
      arfcn: numeric(signal.nr5g_action_channel || signal.Z5g_dlEarfcn),
      band,
      scs: inferScs(band),
      rsrp: numeric(signal.Z5g_rsrp),
      rsrq: numeric(signal.Z5g_rsrq),
      sinr: numeric(signal.Z5g_SINR || signal.Z5g_snr),
      serving: true
    };
    rows.push(serving);
    String(neighbors.sa_ngbr_cell_manual_result_ext || '').split(';').filter(Boolean).forEach(item => {
      const values = item.split(',');
      const neighborBand = normalizeBand(values[4]);
      rows.push({ rat: 'NR', mode: 'sa', pci: numeric(values[0]), arfcn: numeric(values[1]), rsrp: numeric(values[2]), rsrq: numeric(values[3]), band: neighborBand, scs: inferScs(neighborBand), serving: false });
    });
  } else {
    const band = normalizeBand(signal.lte_ca_pcell_band || signal.wan_active_band);
    rows.push({
      rat: 'LTE',
      pci: numeric(signal.lte_pci),
      arfcn: numeric(signal.lte_ca_pcell_arfcn || signal.wan_active_channel),
      band,
      rsrp: numeric(signal.lte_rsrp),
      rsrq: numeric(signal.lte_rsrq),
      sinr: numeric(signal.lte_snr),
      serving: true
    });
    String(neighbors.lte_ngbr_cell_info_ext || '').split(';').filter(Boolean).forEach(item => {
      const values = item.split(',');
      rows.push({ rat: 'LTE', arfcn: numeric(values[0]), pci: numeric(values[1]), rsrq: numeric(values[2]), rsrp: numeric(values[3]), band: normalizeBand(values[4]), serving: false });
    });
  }

  const deduped = new Map();
  rows.filter(item => item.pci != null && item.arfcn != null && item.band != null).forEach(item => {
    const key = `${item.rat}-${item.pci}-${item.arfcn}-${item.band}`;
    const previous = deduped.get(key);
    if (!previous || (item.rsrp ?? -999) > (previous.rsrp ?? -999)) {
      deduped.set(key, { ...previous, ...item, serving: item.serving || previous?.serving, key });
    }
  });
  return [...deduped.values()].sort((left, right) => (right.rsrp ?? -999) - (left.rsrp ?? -999));
}

export function parseNeighborRows(data) {
  const source = data.sa_ngbr_cell_manual_result_ext || data.lte_ngbr_cell_info_ext || '';
  const isNr = String(data.network_type || '').toUpperCase().includes('SA');
  return String(source).split(';').filter(Boolean).map((item, index) => {
    const values = item.split(',');
    return isNr
      ? { id: index, pci: values[0], arfcn: values[1], rsrp: values[2], rsrq: values[3], band: values[4] }
      : { id: index, arfcn: values[0], pci: values[1], rsrq: values[2], rsrp: values[3], band: values[4] };
  });
}
