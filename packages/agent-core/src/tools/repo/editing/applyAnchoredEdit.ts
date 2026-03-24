export type AnchoredEditInput = {
  source: string;
  anchor: string;
  currentText: string;
  replacementText: string;
};

export type AnchoredEditFailureCode =
  | "anchor_not_found"
  | "ambiguous_match"
  | "location_mismatch";

export type AnchoredEditFailure = {
  ok: false;
  error: {
    code: AnchoredEditFailureCode;
    message: string;
  };
};

export type AnchoredEditSuccess = {
  ok: true;
  updatedContent: string;
  targetRange: {
    startOffset: number;
    endOffset: number;
  };
};

export function applyAnchoredEdit(
  input: AnchoredEditInput
): AnchoredEditFailure | AnchoredEditSuccess {
  const anchorMatches = findAllOccurrences(input.source, input.anchor);

  if (anchorMatches.length === 0) {
    return fail("anchor_not_found", `Anchor was not found in the target file.`);
  }

  if (anchorMatches.length > 1) {
    return fail(
      "ambiguous_match",
      `Anchor matched ${anchorMatches.length} region(s); provide a more specific anchor.`
    );
  }

  const targetMatches = findAllOccurrences(input.source, input.currentText);

  if (targetMatches.length === 0) {
    return fail(
      "location_mismatch",
      "The expected target region was not found at the anchored location."
    );
  }

  if (targetMatches.length > 1) {
    return fail(
      "ambiguous_match",
      `The expected target region matched ${targetMatches.length} region(s); provide a more specific block.`
    );
  }

  const anchorStart = anchorMatches[0];
  const targetStart = targetMatches[0];
  const targetEnd = targetStart + input.currentText.length;

  if (anchorStart < targetStart || anchorStart + input.anchor.length > targetEnd) {
    return fail(
      "location_mismatch",
      "The unique anchor does not fall inside the expected target region."
    );
  }

  return {
    ok: true,
    updatedContent:
      input.source.slice(0, targetStart) +
      input.replacementText +
      input.source.slice(targetEnd),
    targetRange: {
      startOffset: targetStart,
      endOffset: targetEnd
    }
  };
}

function findAllOccurrences(source: string, value: string) {
  const matches: number[] = [];
  let searchStart = 0;

  while (searchStart <= source.length) {
    const matchIndex = source.indexOf(value, searchStart);

    if (matchIndex === -1) {
      break;
    }

    matches.push(matchIndex);
    searchStart = matchIndex + Math.max(value.length, 1);
  }

  return matches;
}

function fail(code: AnchoredEditFailureCode, message: string): AnchoredEditFailure {
  return {
    ok: false,
    error: {
      code,
      message
    }
  };
}
