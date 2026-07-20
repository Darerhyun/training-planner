import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePlanningProfile } from './planning-profiles.js';

test('resolves direct course and venue planning profiles with monthly values', () => {
  const profile = resolvePlanningProfile('ASKCAP', 'IP');

  assert.equal(profile.source, 'direct');
  assert.equal(profile.profileCourseCode, 'ASKCAP');
  assert.equal(profile.scheduled18MonthCount, 67);
  assert.equal(profile.confirmationRate, 0.99);
  assert.equal(profile.confirmedPerMonth, 3.67);
  assert.equal(profile.medianGapDays, 6);
  assert.deepEqual(profile.strongMonths, ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Oct', 'Nov', 'Dec']);
  assert.deepEqual(profile.weakMonths, []);
  assert.equal(profile.lowHistoricalConfirmation, false);
});

test('resolves FT proxy history by exact historical course and venue', () => {
  const profile = resolvePlanningProfile('FTDM-DME', 'JTC');

  assert.equal(profile.source, 'ft_proxy');
  assert.equal(profile.profileCourseCode, 'ACDM-DME');
  assert.equal(profile.scheduled18MonthCount, 22);
  assert.equal(profile.confirmationRate, 0.64);
  assert.equal(profile.confirmedPerMonth, 0.78);
  assert.equal(profile.medianGapDays, 42);
  assert.deepEqual(profile.strongMonths, ['May', 'Nov']);
  assert.deepEqual(profile.weakMonths, ['Apr', 'Oct']);
});

test('returns no_history for all intentional blank FT history mappings', () => {
  for (const courseCode of ['FTDM-VM', 'DGAI-SM', 'DGAI-INV', 'DGAI-OPS', 'DGAI-CAP']) {
    const profile = resolvePlanningProfile(courseCode, 'IP');
    assert.equal(profile.source, 'no_history', courseCode);
    assert.equal(profile.profileCourseCode, null);
    assert.equal(profile.lowHistoricalConfirmation, false);
  }
});

test('returns unavailable for missing profiles and does not fall back across venues', () => {
  assert.equal(resolvePlanningProfile('UNKNOWN', 'IP').source, 'unavailable');

  const noCrossVenueFallback = resolvePlanningProfile('ASKCAP', 'JTC');
  assert.equal(noCrossVenueFallback.source, 'unavailable');
  assert.equal(noCrossVenueFallback.profileCourseCode, null);
});

test('sets low historical confirmation only below 50 percent with at least 6 scheduled runs', () => {
  const lowConfirmation = resolvePlanningProfile('ASKCL7', 'JTC');
  assert.equal(lowConfirmation.scheduled18MonthCount, 12);
  assert.equal(lowConfirmation.confirmationRate, 0.17);
  assert.equal(lowConfirmation.lowHistoricalConfirmation, true);

  const tooFewRuns = resolvePlanningProfile('ASKMAA', 'INHOUSE');
  assert.equal(tooFewRuns.scheduled18MonthCount, 5);
  assert.equal(tooFewRuns.confirmationRate, 0);
  assert.equal(tooFewRuns.lowHistoricalConfirmation, false);

  const exactlyHalf = resolvePlanningProfile('DDM-WWC', 'INHOUSE');
  assert.equal(exactlyHalf.scheduled18MonthCount, 2);
  assert.equal(exactlyHalf.confirmationRate, 0.5);
  assert.equal(exactlyHalf.lowHistoricalConfirmation, false);
});