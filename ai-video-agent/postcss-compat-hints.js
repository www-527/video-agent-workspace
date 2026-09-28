module.exports = {
  postcssPlugin: 'compat-hint-pairs',
  Once(root) {
    root.walkRules(rule => {
      const hasDeclaration = prop => rule.nodes?.some(node => node.type === 'decl' && node.prop === prop);

      rule.walkDecls('-webkit-text-size-adjust', decl => {
        if (!hasDeclaration('text-size-adjust')) {
          decl.cloneAfter({ prop: 'text-size-adjust' });
        }
      });

      rule.walkDecls('backdrop-filter', decl => {
        if (!hasDeclaration('-webkit-backdrop-filter')) {
          decl.cloneBefore({ prop: '-webkit-backdrop-filter' });
        }
      });

      rule.walkDecls('user-select', decl => {
        if (!hasDeclaration('-webkit-user-select')) {
          decl.cloneBefore({ prop: '-webkit-user-select' });
        }
      });
    });
  },
};
