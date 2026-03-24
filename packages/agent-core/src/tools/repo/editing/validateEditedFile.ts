export type EditedFileValidationFailure = {
  ok: false;
  error: {
    code: "validation_failed";
    message: string;
  };
};

export type EditedFileValidationSuccess = {
  ok: true;
  validation: {
    changeApplied: true;
    unchangedOutsideRegion: true;
  };
};

export function validateEditedFile(input: {
  originalContent: string;
  updatedContent: string;
  replacementText: string;
  targetRange: {
    startOffset: number;
    endOffset: number;
  };
}): EditedFileValidationFailure | EditedFileValidationSuccess {
  const unchangedPrefix = input.updatedContent.slice(0, input.targetRange.startOffset);
  const expectedPrefix = input.originalContent.slice(0, input.targetRange.startOffset);

  if (unchangedPrefix !== expectedPrefix) {
    return fail("Content before the edited region changed unexpectedly.");
  }

  const updatedRegion = input.updatedContent.slice(
    input.targetRange.startOffset,
    input.targetRange.startOffset + input.replacementText.length
  );

  if (updatedRegion !== input.replacementText) {
    return fail("The replacement text was not written exactly as expected.");
  }

  const updatedSuffix = input.updatedContent.slice(
    input.targetRange.startOffset + input.replacementText.length
  );
  const expectedSuffix = input.originalContent.slice(input.targetRange.endOffset);

  if (updatedSuffix !== expectedSuffix) {
    return fail("Content after the edited region changed unexpectedly.");
  }

  return {
    ok: true,
    validation: {
      changeApplied: true,
      unchangedOutsideRegion: true
    }
  };
}

function fail(message: string): EditedFileValidationFailure {
  return {
    ok: false,
    error: {
      code: "validation_failed",
      message
    }
  };
}
