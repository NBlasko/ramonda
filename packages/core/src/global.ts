import type {
  NamedFrame,
  NamedImage,
  RamondaArgs,
  RefusedOnFields,
  RefusedOnForm,
  RefusedOnMeta,
  RefusedOnSelect,
  SVGArgs,
} from "./types/commonTypes";
import type { RamondaNode, VNode } from "./types/vdom";

declare global {
  namespace JSX {
    /**
     * A JSX tag always evaluates to ONE vnode, i.e. one element. That is the
     * whole point: you can read the DOM structure straight off the JSX.
     *
     * `JSX.ElementType` is deliberately NOT declared. Without it TypeScript
     * applies its default rule — a component used as a tag must return
     * `JSX.Element` — which is exactly the rule Ramonda wants, and it is what
     * rejects a function returning an array of vnodes (TS2786).
     *
     * That rejection is a feature. A function in the tag position would be a
     * tag that is not an element, and a JSX tree you can no longer read. If you
     * need vnodes from a function, call it as an expression — `{rows()}` —
     * where it plainly reads as a value rather than a component. If you need
     * state or lifecycle without an element, that is what a Hook is for; see
     * RMD011 in DIAGNOSTICS.md.
     */
    type Element = VNode;

    interface ElementChildrenAttribute {
      children: RamondaNode;
    }
    // Merged into the props of every JSX element and component. `key` drives
    // keyed reconciliation and accepts a string or a number (so `key={0}` is
    // valid — it is a key, not a falsy value).
    interface IntrinsicAttributes {
      key?: string | number;
      /**
       * On an ELEMENT, the ref receives that element.
       *
       * A component takes no ref: it owns a range of nodes rather than one, so there is no single
       * element for a ref to mean. Put the ref on the element inside the component's render that
       * should carry it, and hand it down as an ordinary prop if the caller is the one who needs it.
       */
      ref?: import("./base/Ref").RefTarget<HTMLElement>;
    }
    interface IntrinsicElements {
      /**
       * A CUSTOM ELEMENT — any tag with a dash in it, which is what the HTML spec reserves for them.
       *
       * Open on purpose: the framework cannot know the tags an application defines, and a custom
       * element accepts whatever attributes its own definition reads. `@Host` used to accept these
       * (its `HostTag` was `keyof JSX.IntrinsicElements | \`${string}-${string}\``), so without this
       * an element a component could be would stop being an element it can render — the capability
       * would have been lost in the move rather than given up on purpose.
       *
       * Anything WITHOUT a dash still has to be a real tag, so `<dvi>` is still a type error.
       */
      [tag: `${string}-${string}`]: RamondaArgs<HTMLElement> & Record<string, unknown>;

      // HTML
      a: RamondaArgs<HTMLAnchorElement>;
      abbr: RamondaArgs<HTMLElement>;
      address: RamondaArgs<HTMLElement>;
      area: RamondaArgs<HTMLAreaElement> & NamedImage;
      article: RamondaArgs<HTMLElement>;
      aside: RamondaArgs<HTMLElement>;
      audio: RamondaArgs<HTMLAudioElement>;
      b: RamondaArgs<HTMLElement>;
      base: RamondaArgs<HTMLBaseElement>;
      bdi: RamondaArgs<HTMLElement>;
      bdo: RamondaArgs<HTMLElement>;
      big: RamondaArgs<HTMLElement>;
      blockquote: RamondaArgs<HTMLQuoteElement>;
      body: RamondaArgs<HTMLBodyElement>;
      br: RamondaArgs<HTMLBRElement>;
      button: RamondaArgs<HTMLButtonElement>;
      canvas: RamondaArgs<HTMLCanvasElement>;
      caption: RamondaArgs<HTMLElement>;
      cite: RamondaArgs<HTMLElement>;
      code: RamondaArgs<HTMLElement>;
      col: RamondaArgs<HTMLTableColElement>;
      colgroup: RamondaArgs<HTMLTableColElement>;
      data: RamondaArgs<HTMLDataElement>;
      datalist: RamondaArgs<HTMLDataListElement>;
      dd: RamondaArgs<HTMLElement>;
      del: RamondaArgs<HTMLModElement>;
      details: RamondaArgs<HTMLDetailsElement>;
      dfn: RamondaArgs<HTMLElement>;
      dialog: RamondaArgs<HTMLDialogElement>;
      div: RamondaArgs<HTMLDivElement>;
      dl: RamondaArgs<HTMLDListElement>;
      dt: RamondaArgs<HTMLElement>;
      em: RamondaArgs<HTMLElement>;
      embed: RamondaArgs<HTMLEmbedElement>;
      fieldset: RamondaArgs<HTMLFieldSetElement>;
      figcaption: RamondaArgs<HTMLElement>;
      figure: RamondaArgs<HTMLElement>;
      footer: RamondaArgs<HTMLElement>;
      form: RamondaArgs<HTMLFormElement> & Partial<RefusedOnForm>;
      h1: RamondaArgs<HTMLHeadingElement>;
      h2: RamondaArgs<HTMLHeadingElement>;
      h3: RamondaArgs<HTMLHeadingElement>;
      h4: RamondaArgs<HTMLHeadingElement>;
      h5: RamondaArgs<HTMLHeadingElement>;
      h6: RamondaArgs<HTMLHeadingElement>;
      head: RamondaArgs<HTMLHeadElement>;
      header: RamondaArgs<HTMLElement>;
      hgroup: RamondaArgs<HTMLElement>;
      hr: RamondaArgs<HTMLHRElement>;
      html: RamondaArgs<HTMLHtmlElement>;
      i: RamondaArgs<HTMLElement>;
      iframe: RamondaArgs<HTMLIFrameElement> & NamedFrame;
      img: RamondaArgs<HTMLImageElement> & NamedImage;
      input: RamondaArgs<HTMLInputElement> & Partial<RefusedOnFields>;
      ins: RamondaArgs<HTMLModElement>;
      kbd: RamondaArgs<HTMLElement>;
      keygen: RamondaArgs<HTMLElement>;
      label: RamondaArgs<HTMLLabelElement>;
      legend: RamondaArgs<HTMLLegendElement>;
      li: RamondaArgs<HTMLLIElement>;
      link: RamondaArgs<HTMLLinkElement>;
      main: RamondaArgs<HTMLElement>;
      map: RamondaArgs<HTMLMapElement>;
      mark: RamondaArgs<HTMLElement>;
      menu: RamondaArgs<HTMLElement>;
      menuitem: RamondaArgs<HTMLElement>;
      meta: RamondaArgs<HTMLMetaElement> & Partial<RefusedOnMeta>;
      meter: RamondaArgs<HTMLMeterElement>;
      nav: RamondaArgs<HTMLElement>;
      noindex: RamondaArgs<HTMLElement>;
      noscript: RamondaArgs<HTMLElement>;
      object: RamondaArgs<HTMLObjectElement>;
      ol: RamondaArgs<HTMLOListElement>;
      optgroup: RamondaArgs<HTMLOptGroupElement>;
      option: RamondaArgs<HTMLOptionElement>;
      output: RamondaArgs<HTMLOutputElement>;
      p: RamondaArgs<HTMLParagraphElement>;
      param: RamondaArgs<HTMLParamElement>;
      picture: RamondaArgs<HTMLElement>;
      pre: RamondaArgs<HTMLPreElement>;
      progress: RamondaArgs<HTMLProgressElement>;
      q: RamondaArgs<HTMLQuoteElement>;
      rp: RamondaArgs<HTMLElement>;
      rt: RamondaArgs<HTMLElement>;
      ruby: RamondaArgs<HTMLElement>;
      s: RamondaArgs<HTMLElement>;
      samp: RamondaArgs<HTMLElement>;
      slot: RamondaArgs<HTMLSlotElement>;
      script: RamondaArgs<HTMLScriptElement>;
      section: RamondaArgs<HTMLElement>;
      select: RamondaArgs<HTMLSelectElement> & Partial<RefusedOnFields> & Partial<RefusedOnSelect>;
      small: RamondaArgs<HTMLElement>;
      source: RamondaArgs<HTMLSourceElement>;
      span: RamondaArgs<HTMLSpanElement>;
      strong: RamondaArgs<HTMLElement>;
      style: RamondaArgs<HTMLStyleElement>;
      sub: RamondaArgs<HTMLElement>;
      summary: RamondaArgs<HTMLElement>;
      sup: RamondaArgs<HTMLElement>;
      table: RamondaArgs<HTMLTableElement>;
      template: RamondaArgs<HTMLTemplateElement>;
      tbody: RamondaArgs<HTMLTableSectionElement>;
      td: RamondaArgs<HTMLTableDataCellElement>;
      textarea: RamondaArgs<HTMLTextAreaElement> & Partial<RefusedOnFields>;
      tfoot: RamondaArgs<HTMLTableSectionElement>;
      th: RamondaArgs<HTMLTableHeaderCellElement>;
      thead: RamondaArgs<HTMLTableSectionElement>;
      time: RamondaArgs<HTMLTimeElement>;
      title: RamondaArgs<HTMLTitleElement>;
      tr: RamondaArgs<HTMLTableRowElement>;
      track: RamondaArgs<HTMLTrackElement>;
      u: RamondaArgs<HTMLElement>;
      ul: RamondaArgs<HTMLUListElement>;
      var: RamondaArgs<HTMLElement>;
      video: RamondaArgs<HTMLVideoElement>;
      wbr: RamondaArgs<HTMLElement>;
      // SVG
      svg: SVGArgs<SVGSVGElement>;
      circle: SVGArgs<SVGCircleElement>;
      clipPath: SVGArgs<SVGClipPathElement>;
      defs: SVGArgs<SVGDefsElement>;
      desc: SVGArgs<SVGDescElement>;
      ellipse: SVGArgs<SVGEllipseElement>;
      feBlend: SVGArgs<SVGFEBlendElement>;
      feColorMatrix: SVGArgs<SVGFEColorMatrixElement>;
      feComponentTransfer: SVGArgs<SVGFEComponentTransferElement>;
      feComposite: SVGArgs<SVGFECompositeElement>;
      feConvolveMatrix: SVGArgs<SVGFEConvolveMatrixElement>;
      feDiffuseLighting: SVGArgs<SVGFEDiffuseLightingElement>;
      feDisplacementMap: SVGArgs<SVGFEDisplacementMapElement>;
      feDistantLight: SVGArgs<SVGFEDistantLightElement>;
      feDropShadow: SVGArgs<SVGFEDropShadowElement>;
      feFlood: SVGArgs<SVGFEFloodElement>;
      feFuncA: SVGArgs<SVGFEFuncAElement>;
      feFuncB: SVGArgs<SVGFEFuncBElement>;
      feFuncG: SVGArgs<SVGFEFuncGElement>;
      feFuncR: SVGArgs<SVGFEFuncRElement>;
      feGaussianBlur: SVGArgs<SVGFEGaussianBlurElement>;
      feImage: SVGArgs<SVGFEImageElement>;
      feMerge: SVGArgs<SVGFEMergeElement>;
      feMergeNode: SVGArgs<SVGFEMergeNodeElement>;
      feMorphology: SVGArgs<SVGFEMorphologyElement>;
      feOffset: SVGArgs<SVGFEOffsetElement>;
      fePointLight: SVGArgs<SVGFEPointLightElement>;
      feSpecularLighting: SVGArgs<SVGFESpecularLightingElement>;
      feSpotLight: SVGArgs<SVGFESpotLightElement>;
      feTile: SVGArgs<SVGFETileElement>;
      feTurbulence: SVGArgs<SVGFETurbulenceElement>;
      filter: SVGArgs<SVGFilterElement>;
      foreignObject: SVGArgs<SVGForeignObjectElement>;
      g: SVGArgs<SVGGElement>;
      image: SVGArgs<SVGImageElement>;
      line: SVGArgs<SVGLineElement>;
      linearGradient: SVGArgs<SVGLinearGradientElement>;
      marker: SVGArgs<SVGMarkerElement>;
      mask: SVGArgs<SVGMaskElement>;
      metadata: SVGArgs<SVGMetadataElement>;
      mpath: SVGArgs<SVGMPathElement>;
      path: SVGArgs<SVGPathElement>;
      pattern: SVGArgs<SVGPatternElement>;
      polygon: SVGArgs<SVGPolygonElement>;
      polyline: SVGArgs<SVGPolylineElement>;
      radialGradient: SVGArgs<SVGRadialGradientElement>;
      rect: SVGArgs<SVGRectElement>;
      stop: SVGArgs<SVGStopElement>;
      switch: SVGArgs<SVGSwitchElement>;
      symbol: SVGArgs<SVGSymbolElement>;
      text: SVGArgs<SVGTextElement>;
      textPath: SVGArgs<SVGTextPathElement>;
      tspan: SVGArgs<SVGTSpanElement>;
      use: SVGArgs<SVGUseElement>;
      view: SVGArgs<SVGViewElement>;
    }
  }
}
