// Copyright (c) 2020 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as Platform from '../../../../front_end/platform/platform.js';

const {assert} = chai;

function comparator(a: number, b: number): number {
  return a < b ? -1 : (a > b ? 1 : 0);
}

describe('ArrayUtilities', () => {
  describe('removeElement', () => {
    it('removes elements', () => {
      const testCases = [
        {input: [], expectedFirstOnlyTrue: [], expectedFirstOnlyFalse: []},
        {input: [1], expectedFirstOnlyTrue: [1], expectedFirstOnlyFalse: [1]},
        {
          input: [1, 2, 3, 4, 5, 4, 3, 2, 1],
          expectedFirstOnlyTrue: [1, 3, 4, 5, 4, 3, 2, 1],
          expectedFirstOnlyFalse: [1, 3, 4, 5, 4, 3, 1],
        },
        {input: [2, 2, 2, 2, 2], expectedFirstOnlyTrue: [2, 2, 2, 2], expectedFirstOnlyFalse: []},
        {input: [2, 2, 2, 1, 2, 2, 3, 2], expectedFirstOnlyTrue: [2, 2, 1, 2, 2, 3, 2], expectedFirstOnlyFalse: [1, 3]},
      ];

      for (const testCase of testCases) {
        const actualFirstOnlyTrue = [...testCase.input];

        Platform.ArrayUtilities.removeElement(actualFirstOnlyTrue, 2, true);
        assert.deepStrictEqual(actualFirstOnlyTrue, testCase.expectedFirstOnlyTrue, 'Removing firstOnly (true) failed');

        const actualFirstOnlyFalse = [...testCase.input];
        Platform.ArrayUtilities.removeElement(actualFirstOnlyFalse, 2, false);
        assert.deepStrictEqual(
            actualFirstOnlyFalse, testCase.expectedFirstOnlyFalse, 'Removing firstOnly (false) failed');
      }
    });
  });

  const fixtures = [
    [],
    [1],
    [2, 1],
    [6, 4, 2, 7, 10, 15, 1],
    [10, 44, 3, 6, 56, 66, 10, 55, 32, 56, 2, 5],
  ];
  for (let i = 0; i < fixtures.length; i++) {
    const fixture = fixtures[i];

    it(`sorts ranges, fixture ${i}`, () => {
      for (let left = 0, l = fixture.length - 1; left < l; ++left) {
        for (let right = left, r = fixture.length; right < r; ++right) {
          for (let first = left; first <= right; ++first) {
            for (let count = 1, k = right - first + 1; count <= k; ++count) {
              const actual = fixture.slice(0);
              Platform.ArrayUtilities.sortRange(actual, comparator, left, right, first, first + count - 1);
              assert.deepStrictEqual(
                  fixture.slice(0, left), actual.slice(0, left), 'left ' + left + ' ' + right + ' ' + count);
              assert.deepStrictEqual(
                  fixture.slice(right + 1), actual.slice(right + 1), 'right ' + left + ' ' + right + ' ' + count);

              const middle = fixture.slice(left, right + 1);
              middle.sort(comparator);
              assert.deepStrictEqual(
                  middle.slice(first - left, first - left + count), actual.slice(first, first + count),
                  'sorted ' + left + ' ' + right + ' ' + first + ' ' + count);

              const actualRest = actual.slice(first + count, right + 1);
              actualRest.sort(comparator);
              assert.deepStrictEqual(
                  middle.slice(first - left + count), actualRest,
                  'unsorted ' + left + ' ' + right + ' ' + first + ' ' + count);
            }
          }
        }
      }
    });
  }
});
