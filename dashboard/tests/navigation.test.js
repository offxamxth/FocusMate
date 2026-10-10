import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isUnknownPath,
  mobileDestinationFromLocation,
  navigationPath,
  pageFromLocation,
  publicPageFromLocation,
} from '../src/navigation.js';

function location(pathname = '/', hash = '') {
  return { pathname, hash };
}

test('mobile destinations resolve to the existing application pages', () => {
  assert.equal(pageFromLocation(location('/', '#overview')), 'overview');
  assert.equal(pageFromLocation(location('/', '#tasks')), 'overview');
  assert.equal(pageFromLocation(location('/', '#focus')), 'focus-room');
  assert.equal(pageFromLocation(location('/', '#rooms')), 'focus-room');
  assert.equal(pageFromLocation(location('/', '#profile')), 'profile');
});

test('legacy and secondary destinations remain directly addressable', () => {
  assert.equal(pageFromLocation(location('/', '#focus-room')), 'focus-room');
  assert.equal(mobileDestinationFromLocation(location('/', '#focus-room')), 'focus');
  assert.equal(pageFromLocation(location('/', '#leaderboard')), 'leaderboard');
  assert.equal(pageFromLocation(location('/contact')), 'contact');
});

test('public pages resolve from clean paths without changing authenticated hash routes', () => {
  for (const page of ['about', 'contact', 'privacy']) {
    assert.equal(publicPageFromLocation(location(`/${page}`)), page);
    assert.equal(pageFromLocation(location(`/${page}`)), page);
  }
  assert.equal(navigationPath('about'), '/about');
  assert.equal(navigationPath('contact'), '/#contact');
  assert.equal(navigationPath('privacy'), '/privacy');
  assert.equal(publicPageFromLocation(location('/privacy/')), 'privacy');
  assert.equal(publicPageFromLocation(location('/#privacy')), null);
  assert.equal(pageFromLocation(location('/', '#privacy')), 'overview');
  assert.equal(isUnknownPath(location('/unknown')), true);
  assert.equal(isUnknownPath(location('/unknown/')), true);
  assert.equal(isUnknownPath(location('/')), false);
  assert.equal(isUnknownPath(location('/index.html')), false);
  assert.equal(isUnknownPath(location('/contact/')), false);
});

test('navigation paths retain the existing contact path and hash routes', () => {
  assert.equal(navigationPath('overview'), '/#overview');
  assert.equal(navigationPath('tasks'), '/#tasks');
  assert.equal(navigationPath('leaderboard'), '/#leaderboard');
  assert.equal(navigationPath('contact'), '/#contact');
  assert.equal(navigationPath('privacy'), '/privacy');
});
