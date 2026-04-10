export default {
  extends: ["@commitlint/config-conventional"],
  parserPreset: {
    parserOpts: {
      // Allow optional leading emoji before the conventional commit type
      headerPattern: /^(?:\p{Emoji_Presentation}\s)?(\w*)(?:\(([\w$.\-* ]*)\))?!?: (.*)$/u,
      headerCorrespondence: ["type", "scope", "subject"],
    },
  },
};
