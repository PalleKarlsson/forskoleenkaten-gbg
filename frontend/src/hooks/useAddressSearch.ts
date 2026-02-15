import { useState, useEffect, useRef } from "react";

export interface AddressResult {
  displayName: string;
  lat: number;
  lng: number;
}

export function useAddressSearch(input: string) {
  const [results, setResults] = useState<AddressResult[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (input.trim().length < 3) {
      setResults([]);
      setLoading(false);
      return;
    }

    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);

      const params = new URLSearchParams({
        q: `${input}, Göteborg`,
        format: "json",
        limit: "5",
        viewbox: "11.5,57.5,12.3,58.1",
        bounded: "1",
      });

      fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
        signal: controller.signal,
        headers: { "User-Agent": "forskoleenkaten-gbg/1.0" },
      })
        .then((res) => res.json())
        .then((data: Array<{ display_name: string; lat: string; lon: string }>) => {
          setResults(
            data.map((d) => ({
              displayName: d.display_name,
              lat: parseFloat(d.lat),
              lng: parseFloat(d.lon),
            })),
          );
          setLoading(false);
        })
        .catch((err) => {
          if (err.name !== "AbortError") {
            setLoading(false);
          }
        });
    }, 400);

    return () => clearTimeout(timer);
  }, [input]);

  return { results, loading };
}
