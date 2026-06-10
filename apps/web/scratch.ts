import { useQuery } from "@tanstack/react-query";
useQuery({
  queryKey: ["test"],
  queryFn: async () => 1,
  refetchInterval: (arg1, arg2) => {
    console.log(arg1, arg2);
    return 3000;
  }
});
