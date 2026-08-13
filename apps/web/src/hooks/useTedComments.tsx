import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useAuthAxios } from "../lib/useAuthAxios"
import {
  getTedComments,
  createTedComment,
  deleteTedComment,
  deleteAllTedComments,
  CreateTedCommentInput,
} from "../api/tedComments.api"
import toast from "react-hot-toast"

export const useTedComments = (projectId: string) => {
  const axios = useAuthAxios()
  return useQuery({
    queryKey: ["ted-comments", projectId],
    queryFn: () => getTedComments(axios, projectId),
    enabled: !!projectId,
  })
}

export const useCreateTedComment = () => {
  const axios = useAuthAxios()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateTedCommentInput) => createTedComment(axios, input),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["ted-comments", variables.project_id],
      })
      toast.success("Comment added")
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || "Failed to add comment")
    },
  })
}

export const useDeleteTedComment = (projectId: string) => {
  const axios = useAuthAxios()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteTedComment(axios, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ted-comments", projectId] })
      toast.success("Comment deleted")
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || "Failed to delete comment")
    },
  })
}

export const useDeleteAllTedComments = (projectId: string) => {
  const axios = useAuthAxios()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => deleteAllTedComments(axios, projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ted-comments", projectId] })
      toast.success("All comments deleted")
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || "Failed to delete comments")
    },
  })
}
