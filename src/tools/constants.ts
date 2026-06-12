/** Opening tag of the model's control-block tool-call syntax (`<flyflor:tool>{...}</flyflor:tool>`). */
export const TOOL_BLOCK_OPEN_TAG = '<flyflor:tool>';

/** Closing tag of the model's control-block tool-call syntax. */
export const TOOL_BLOCK_CLOSE_TAG = '</flyflor:tool>';

/** Marker line prepended to a truncated tool result so provenance is never silent. */
export const TOOL_RESULT_CLIPPED_NOTICE = '[clipped: result exceeded the tool budget; head and tail kept, middle dropped]';

/** Fraction of a clipped result budget spent on the head; the rest keeps the tail. */
export const TOOL_RESULT_HEAD_RATIO = 0.5;
