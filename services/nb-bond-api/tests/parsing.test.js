"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const parsing_1 = require("../src/parsing");
describe('parseBigInt', () => {
    it('parses numeric strings with whitespace', () => {
        expect((0, parsing_1.parseBigInt)(' 42 ', 'value')).toBe(42n);
    });
    it('rejects non-numeric input', () => {
        expect(() => (0, parsing_1.parseBigInt)('not-a-number', 'amount')).toThrow('amount must be numeric');
    });
});
describe('parsePositiveBigInt', () => {
    it('rejects zero values', () => {
        expect(() => (0, parsing_1.parsePositiveBigInt)('0', 'size')).toThrow('size must be positive');
    });
    it('rejects negative values', () => {
        expect(() => (0, parsing_1.parsePositiveBigInt)('-1', 'size')).toThrow('size must be positive');
    });
});
//# sourceMappingURL=parsing.test.js.map