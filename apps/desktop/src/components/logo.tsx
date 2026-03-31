import { type ComponentProps, forwardRef } from "react";

export const Logo = forwardRef<SVGSVGElement, ComponentProps<"svg">>(
  function Logo(props, ref) {
    return (
      <svg
        fill="none"
        ref={ref}
        viewBox="0 0 1218 1218"
        xmlns="http://www.w3.org/2000/svg"
        {...props}
      >
        <path
          d="M608.75 48L1065.5 276.375L608.75 504.75L152 276.375L608.75 48Z"
          fill="currentColor"
        />
        <path
          d="M152 352.5L570.688 561.844V714.094L152 504.75V352.5Z"
          fill="currentColor"
          opacity="0.8"
        />
        <path
          d="M152 580.875L570.688 790.219V942.469L152 733.125V580.875Z"
          fill="currentColor"
          opacity="0.5"
        />
        <path
          d="M152 809.25L570.688 1018.59V1170.84L152 961.5V809.25Z"
          fill="currentColor"
          opacity="0.2"
        />
        <path
          d="M646.812 561.844L1065.5 352.5V504.75L646.812 714.094V561.844Z"
          fill="currentColor"
          opacity="0.6"
        />
        <path
          d="M646.812 790.219L1065.5 580.875V733.125L646.812 942.469V790.219Z"
          fill="currentColor"
          opacity="0.3"
        />
        <path
          d="M646.812 1018.59L1065.5 809.25V961.5L646.812 1170.84V1018.59Z"
          fill="currentColor"
          opacity="0.1"
        />
      </svg>
    );
  }
);
